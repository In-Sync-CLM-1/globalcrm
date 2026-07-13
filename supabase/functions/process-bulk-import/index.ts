import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getSupabaseClient } from '../_shared/supabaseClient.ts';
import { logEdgeError, logStep, logBatchProgress, logValidationError } from '../_shared/errorLogger.ts';

const OPERATION_TIMEOUT = 20 * 60 * 1000; // 20 minutes
const MAX_RETRIES = 3;
const BATCH_SIZE = 500; // Reduced for better memory management
const PROGRESS_UPDATE_INTERVAL = 5000; // 5 seconds - more frequent updates

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ImportJob {
  id: string;
  org_id: string;
  user_id: string;
  file_name: string;
  file_path: string;
  import_type: string;
  target_id: string | null;
}

interface ContactRecord {
  org_id: string;
  first_name: string;
  last_name?: string;
  email?: string;
  phone?: string;
  company?: string;
  job_title?: string;
  organization_name?: string;
  organization_founded_year?: number;
  organization_industry?: string;
  industry_type?: string;
  nature_of_business?: string;
  status?: string;
  source?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  postal_code?: string;
  headline?: string;
  seniority?: string;
  referred_by?: string;
  website?: string;
  linkedin_url?: string;
  twitter_url?: string;
  github_url?: string;
  facebook_url?: string;
  photo_url?: string;
  notes?: string;
  created_by: string;
}

function parseCSVLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current.trim());

  return values.map(v => v.replace(/^"|"$/g, ''));
}

function normalizeHeader(header: string): string {
  return header.toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  let supabase: any;

  try {
    console.log('[INIT] Starting bulk import processor');
    
    supabase = getSupabaseClient();

    const { importJobId } = await req.json();
    
    if (!importJobId) {
      throw new Error('Missing importJobId');
    }

    console.log('[JOB] Processing job:', importJobId);

    // Fetch import job
    const { data: importJob, error: jobError } = await supabase
      .from('import_jobs')
      .select('*')
      .eq('id', importJobId)
      .single() as { data: ImportJob | null; error: any };

    if (jobError || !importJob) {
      throw new Error(`Import job not found: ${jobError?.message}`);
    }

    console.log('[JOB] Found:', importJob.file_name, 'Type:', importJob.import_type);

    // Download file from storage
    await updateJobStage(supabase, importJobId, 'downloading', {
      message: 'Downloading file...'
    });

    const { data: fileData, error: downloadError } = await supabase.storage
      .from('import-files')
      .download(importJob.file_path);

    if (downloadError || !fileData) {
      throw new Error(`Failed to download file: ${downloadError?.message}`);
    }

    const fileSizeKB = Math.round(fileData.size / 1024);
    console.log('[STORAGE] File downloaded:', fileSizeKB, 'KB');

    // Convert blob to text
    const csvText = await fileData.text();
    const lines = csvText.split('\n').filter((line: string) => line.trim());

    if (lines.length === 0) {
      throw new Error('CSV file is empty');
    }

    // Validate row count for fervent_repository before processing
    const dataRowCount = lines.length - 1; // Exclude header row
    if (importJob.import_type === 'fervent_repository' && dataRowCount > 5000) {
      throw new Error('CSV file contains too many rows. Maximum allowed is 5,000 records.');
    }

    // Parse headers
    await updateJobStage(supabase, importJobId, 'validating', {
      message: 'Validating CSV structure...',
      file_size_kb: fileSizeKB
    });

    const headers = parseCSVLine(lines[0]).map(h => normalizeHeader(h));
    console.log('[PARSE] Headers detected:', headers);

    // Validate org for fervent_repository ONCE before processing
    if (importJob.import_type === 'fervent_repository') {
      const { data: org } = await supabase
        .from('organizations')
        .select('slug')
        .eq('id', importJob.org_id)
        .single();

      if (org?.slug !== 'fervent-communication') {
        throw new Error('This import type is exclusive to Fervent Communication');
      }
      console.log('[VALIDATE] Organization validated for fervent repository');
    }

    // Validate required columns based on import type
    let requiredColumns: string[];
    switch (importJob.import_type) {
      case 'contacts':
        requiredColumns = ['first_name', 'email'];
        break;
      case 'fervent_repository':
        requiredColumns = ['full_name'];
        break;
      case 'email_recipients':
      case 'whatsapp_recipients':
        requiredColumns = ['email'];
        break;
      default:
        requiredColumns = ['email'];
    }
    
    const missingColumns = requiredColumns.filter(col => !headers.includes(col));
    if (missingColumns.length > 0) {
      throw new Error(`Missing required columns: ${missingColumns.join(', ')}`);
    }

    // For contact imports, build a stage-name -> id lookup so an uploaded
    // "pipeline_stage" (or "stage") column can set each contact's pipeline stage.
    // Matching is case-insensitive on the active stage names for this org;
    // an unrecognised value just leaves the stage unset (no row failure).
    const stageNameToId: Record<string, string> = {};
    if (importJob.import_type === 'contacts') {
      const { data: orgStages } = await supabase
        .from('pipeline_stages')
        .select('id, name')
        .eq('org_id', importJob.org_id)
        .eq('is_active', true);
      for (const s of orgStages || []) {
        stageNameToId[String(s.name).trim().toLowerCase()] = s.id;
      }
    }

    // Parse and process data
    await updateJobStage(supabase, importJobId, 'parsing', {
      message: 'Parsing CSV data...',
      headers_found: headers.length,
      total_batches: Math.ceil((lines.length - 1) / BATCH_SIZE)
    });

    const totalRows = lines.length - 1;
    let processedRows = 0;
    let successCount = 0;
    let errorCount = 0;
    let duplicateCount = 0;
    let updatedCount = 0;
    const duplicateSamples: Array<{ matched_on: string; value: string }> = [];
    const errors: Array<{row?: number; field?: string; message: string; sample?: string}> = [];
    let batch: any[] = [];
    let batchNumber = 0;
    let lastProgressUpdate = Date.now();

    let currentRowNumber = 1;
    for (let i = 1; i < lines.length; i++) {
      currentRowNumber = i + 1;
      const line = lines[i].trim();
      if (!line) continue;

      // Progress update every 100 rows during parsing
      if (i % 100 === 0) {
        const now = Date.now();
        if (now - lastProgressUpdate > PROGRESS_UPDATE_INTERVAL) {
          await updateJobProgress(supabase, importJobId, {
            total_rows: totalRows,
            processed_rows: processedRows,
            success_count: successCount,
            error_count: errorCount,
            current_stage: 'parsing',
            stage_details: {
              message: `Parsing row ${i} of ${totalRows}...`,
              rows_parsed: i
            }
          });
          lastProgressUpdate = now;
          console.log(`[PROGRESS] Parsed ${i}/${totalRows} rows`);
        }
      }

      try {
        const values = parseCSVLine(line);
        const row: any = {};
        headers.forEach((header, idx) => {
          row[header] = values[idx] || '';
        });

        // Map to target table structure
        let record: any;
        if (importJob.import_type === 'contacts') {
          record = {
            org_id: importJob.org_id,
            first_name: row.first_name,
            last_name: row.last_name || '',
            email: row.email || null,
            phone: row.phone || null,
            company: row.company || null,
            job_title: row.job_title || null,
            organization_name: row.organization_name || null,
            organization_founded_year: row.organization_founded_year ? parseInt(row.organization_founded_year) : null,
            organization_industry: row.organization_industry || null,
            industry_type: row.industry_type || null,
            nature_of_business: row.nature_of_business || null,
            status: row.status || 'new',
            source: row.source || 'bulk_import',
            pipeline_stage_id: stageNameToId[String(row.action || row.pipeline_stage || row.stage || '').trim().toLowerCase()] || null,
            address: row.address || null,
            city: row.city || row.location_city || null,
            state: row.state || row.location_state || null,
            country: row.country || null,
            postal_code: row.postal_code || row.location_zip || null,
            headline: row.headline || null,
            seniority: row.seniority || null,
            referred_by: row.referred_by || null,
            website: row.website || null,
            linkedin_url: row.linkedin_url || null,
            twitter_url: row.twitter_url || null,
            github_url: row.github_url || null,
            facebook_url: row.facebook_url || null,
            photo_url: row.photo_url || null,
            notes: row.notes || null,
            created_by: importJob.user_id
          };
        } else if (importJob.import_type === 'email_recipients') {
          record = {
            campaign_id: importJob.target_id,
            contact_id: null,
            email: row.email,
            custom_data: row,
            status: 'pending'
          };
        } else if (importJob.import_type === 'whatsapp_recipients') {
          record = {
            campaign_id: importJob.target_id,
            contact_id: null,
            phone_number: row.phone,
            custom_data: row,
            status: 'pending'
          };
        } else if (importJob.import_type === 'fervent_repository') {
          record = {
            org_id: importJob.org_id,
            sr_no: row.sr_no ? parseInt(row.sr_no) : null,
            unique_id: row.unique_id || null,
            db_sourced_year: row.db_sourced_year ? parseInt(row.db_sourced_year) : null,
            ucdb_status: row.ucdb_status || null,
            company_name: row.company_name || null,
            first_name: row.first_name || null,
            last_name: row.last_name || null,
            full_name: row.full_name,
            designation: row.designation || null,
            department: row.department || null,
            designation_level: row.designation_level || null,
            city: row.city || null,
            state: row.state || null,
            country: row.country || null,
            isd_code: row.isd_code || null,
            std_code: row.std_code || null,
            mobile_number_1: row.mobile_number_1 || null,
            mobile_number_2: row.mobile_number_2 || null,
            direct_number: row.direct_number || null,
            phone_number: row.phone_number || null,
            official_email: row.official_email_id || row.official_email || null,
            personal_email_1: row.personal_email_id_1 || row.personal_email_1 || null,
            personal_email_2: row.personal_email_id_2 || row.personal_email_2 || null,
            linkedin_url: row.contact_linkedin_id || row.linkedin_url || null,
            domain_name: row.domain_name || null,
            website: row.website || null,
            industry: row.industry || null,
            sub_industry: row.subindustry || row.sub_industry || null,
            employee_size: row.employee_size || null,
            turnover: row.turnover || null,
            company_linkedin_url: row.company_linkedin_id || row.company_linkedin_url || null,
            created_by: importJob.user_id,
            import_job_id: importJob.id
          };
        }

        batch.push(record);
        processedRows++;

        // Check if too many errors - stop processing
        if (errors.length >= 500) {
          console.error('[ERROR] Too many errors (>500), stopping import');
          await supabase.from('import_jobs').update({
            status: 'failed',
            error_count: errors.length,
            error_details: errors,
            completed_at: new Date().toISOString(),
            stage_details: {
              error: 'Import stopped: Too many errors',
              max_errors_reached: true
            }
          }).eq('id', importJobId);
          
          return new Response(JSON.stringify({
            success: false,
            error: 'Too many errors (>500)',
            errorCount: errors.length
          }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Process batch when full
        if (batch.length >= BATCH_SIZE) {
          batchNumber++;
          console.log(`[BATCH] Processing batch ${batchNumber} with ${batch.length} records`);
          
          const result = await processBatch(supabase, importJob, batch, batchNumber);
          successCount += result.inserted;
          updatedCount += result.updated;

          if (result.skipped > 0) {
            console.log(`[BATCH] Skipped ${result.skipped} duplicate records in batch ${batchNumber}`);
            duplicateCount += result.skipped;
            if (result.duplicateSamples) {
              duplicateSamples.push(...result.duplicateSamples.slice(0, Math.max(0, 200 - duplicateSamples.length)));
            }
          }
          if (result.dbErrors) {
            errorCount += result.dbErrors;
            if (result.dbErrorSamples) errors.push(...result.dbErrorSamples);
          }

          batch = [];

          // Update progress after each batch WITH error details for real-time visibility
          await updateJobProgress(supabase, importJobId, {
            total_rows: totalRows,
            processed_rows: processedRows,
            success_count: successCount,
            error_count: errorCount,
            duplicate_count: duplicateCount,
            updated_count: updatedCount,
            error_details: errors.slice(-100), // Save last 100 errors in real-time
            current_stage: 'inserting',
            stage_details: {
              message: `Inserted batch ${batchNumber} (${successCount} records inserted, ${updatedCount} updated, ${errorCount} errors, ${duplicateCount} duplicates skipped)`,
              batches_completed: batchNumber,
              total_batches: Math.ceil(totalRows / BATCH_SIZE)
            }
          });
          lastProgressUpdate = Date.now();
        }

      } catch (error) {
        errorCount++;
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        errors.push({
          row: currentRowNumber,
          field: 'parsing',
          message: errorMessage,
          sample: line.substring(0, 100)
        });
        console.log(`[ERROR] Row ${currentRowNumber}: ${errorMessage}`);
      }
    }

    // Process remaining batch
    if (batch.length > 0) {
      batchNumber++;
      const result = await processBatch(supabase, importJob, batch, batchNumber);
      successCount += result.inserted;
      updatedCount += result.updated;
      if (result.skipped > 0) {
        duplicateCount += result.skipped;
        if (result.duplicateSamples) {
          duplicateSamples.push(...result.duplicateSamples.slice(0, Math.max(0, 200 - duplicateSamples.length)));
        }
      }
      if (result.dbErrors) {
        errorCount += result.dbErrors;
        if (result.dbErrorSamples) errors.push(...result.dbErrorSamples);
      }
    }

    console.log('[COMPLETE] Processed:', successCount, 'success,', errorCount, 'errors');

    // Finalize import
    await updateJobStage(supabase, importJobId, 'finalizing', {
      message: 'Finalizing import...',
      total_success: successCount,
      total_errors: errorCount
    });

    // Cleanup file
    const { error: deleteError } = await supabase.storage
      .from('bulk-imports')
      .remove([importJob.file_path]);

    if (deleteError) {
      console.error('[CLEANUP] Failed to delete file:', deleteError);
    } else {
      console.log('[CLEANUP] File deleted successfully');
    }

    // Update final status
    const duration = Math.round((Date.now() - startTime) / 1000);
    await supabase.from('import_jobs').update({
      status: 'completed',
      current_stage: 'completed',
      total_rows: totalRows,
      processed_rows: processedRows,
      success_count: successCount,
      error_count: errorCount,
      duplicate_count: duplicateCount,
      updated_count: updatedCount,
      error_details: errors.slice(-500), // Store up to 500 errors for better debugging
      completed_at: new Date().toISOString(),
      file_cleaned_up: !deleteError,
      file_cleanup_at: new Date().toISOString(),
      stage_details: {
        message: `Import completed in ${duration}s`,
        total_success: successCount,
        total_updated: updatedCount,
        total_errors: errorCount,
        total_duplicates: duplicateCount,
        duplicate_samples: duplicateSamples
      }
    }).eq('id', importJobId);

    console.log('[SUCCESS] Import completed in', duration, 'seconds');

    return new Response(JSON.stringify({
      success: true,
      processed: successCount,
      errors: errorCount
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[ERROR] Processing failed:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    
    if (supabase && req.body) {
      try {
        const body = await req.json();
        await supabase.from('import_jobs').update({
          status: 'failed',
          current_stage: 'failed',
          completed_at: new Date().toISOString(),
          error_details: [{
            error: errorMessage,
            stack: errorStack,
            timestamp: new Date().toISOString()
          }],
          stage_details: { error: errorMessage }
        }).eq('id', body.importJobId);
      } catch (updateError) {
        console.error('[ERROR] Failed to update job status:', updateError);
      }
    }

    return new Response(JSON.stringify({
      error: 'Processing failed',
      message: errorMessage
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

async function updateJobStage(supabase: any, jobId: string, stage: string, details: any) {
  await supabase.from('import_jobs').update({
    current_stage: stage,
    stage_details: details,
    updated_at: new Date().toISOString()
  }).eq('id', jobId);
}

async function updateJobProgress(supabase: any, jobId: string, progress: any) {
  await supabase.from('import_jobs').update({
    ...progress,
    updated_at: new Date().toISOString()
  }).eq('id', jobId);
}

async function processBatch(
  supabase: any,
  importJob: ImportJob,
  batch: any[],
  batchNumber: number
): Promise<{ inserted: number; updated: number; skipped: number; dbErrors?: number; duplicateSamples?: Array<{ matched_on: string; value: string }>; dbErrorSamples?: Array<{ row?: number; field?: string; message: string; sample?: string }> }> {
  console.log('[DB] Inserting batch', batchNumber, 'with', batch.length, 'records');

  try {
    let tableName: string;
    let upsertOptions: any = {};
    let skippedCount = 0;
    const duplicateSamples: Array<{ matched_on: string; value: string }> = [];

    if (importJob.import_type === 'contacts') {
      tableName = 'contacts';
      
      // Get all emails from batch
      const emailsToCheck = batch
        .map(r => r.email)
        .filter(email => email && email.trim() !== '');
      
      let existingEmails = new Set();
      
      // Check which emails already exist in database
      if (emailsToCheck.length > 0) {
        const { data: existingByEmail } = await supabase
          .from('contacts')
          .select('email')
          .eq('org_id', importJob.org_id)
          .in('email', emailsToCheck);
        
        existingEmails = new Set(
          (existingByEmail || []).map((r: any) => r.email?.trim()?.toLowerCase())
        );
      }
      
      // Deduplicate: skip emails that exist in DB or in batch
      const deduped = [];
      const seenInBatch = new Set();
      
      for (let i = batch.length - 1; i >= 0; i--) {
        const record = batch[i];
        const email = record.email?.trim()?.toLowerCase();
        
        if (!email) {
          // Allow records without email (phone can duplicate)
          deduped.unshift(record);
        } else if (existingEmails.has(email)) {
          // Skip: email exists in database
          skippedCount++;
          logValidationError(i, 'email', 'Duplicate email in database', email);
        } else if (seenInBatch.has(email)) {
          // Skip: email already seen in this batch
          skippedCount++;
          logValidationError(i, 'email', 'Duplicate email in batch', email);
        } else {
          // Add to batch
          seenInBatch.add(email);
          deduped.unshift(record);
        }
      }
      
      batch = deduped;
      
      if (skippedCount > 0) {
        console.log(`[DB] Batch ${batchNumber}: Filtered ${skippedCount} duplicate emails, inserting ${batch.length} records`);
      }
      // No upsertOptions - use simple insert for contacts
    } else if (importJob.import_type === 'email_recipients') {
      tableName = 'email_campaign_recipients';
      upsertOptions = {
        onConflict: 'email',
        ignoreDuplicates: false
      };
    } else if (importJob.import_type === 'whatsapp_recipients') {
      tableName = 'whatsapp_campaign_recipients';
      upsertOptions = {
        onConflict: 'phone_number',
        ignoreDuplicates: false
      };
    } else if (importJob.import_type === 'fervent_repository') {
      return await processFerventBatch(supabase, importJob, batch, batchNumber);
    } else {
      throw new Error(`Unknown import type: ${importJob.import_type}`);
    }

    // Use insert for contacts, upsert for campaign recipients
    const { error } = (importJob.import_type === 'contacts')
      ? await supabase.from(tableName).insert(batch)
      : await supabase.from(tableName).upsert(batch, upsertOptions);

    if (error) {
      console.error('[DB] Batch insert failed:', error);
      throw error;
    }

    console.log('[DB] Batch', batchNumber, 'inserted successfully');
    return { inserted: batch.length, updated: 0, skipped: skippedCount, duplicateSamples };
  } catch (error) {
    console.error('[DB] Batch processing error:', error);
    throw error;
  }
}

// =============================================================================
// FERVENT REPOSITORY: Unique ID match/update, plus AI-assisted duplicate
// containment for rows that arrive with no Unique ID (uploads are distributed
// across sources, so the same person routinely re-appears with a different or
// missing Unique ID). See supabase/migrations/20260710120000_fervent_ai_dedupe.sql.
//
//   1. Unique ID matches an existing record for this org -> UPDATE it.
//   2. No Unique ID -> containment before insert:
//      a. exact phone/email overlap with an existing record -> merge into it.
//      b. same normalised full name, no contact overlap -> Groq verifies
//         "same person?" from company/designation/location context.
//      c. no match at all, or AI says different person -> stays new.
//   3. Rows still new after containment, plus duplicates of each other within
//      the same file, get a system-assigned FERVENT-nnnnnn Unique ID.
//
// Merge semantics: incoming non-empty values overwrite the existing ones;
// empty cells never blank out data already on the record.
// =============================================================================

const GROQ_MODEL = 'llama-3.3-70b-versatile';
const HAIKU_MODEL = 'claude-haiku-4-5';

function normPhone(v: any): string | null {
  if (!v) return null;
  const digits = String(v).replace(/\D/g, '');
  if (digits.length < 8) return null;
  return digits.slice(-10);
}

function normEmail(v: any): string | null {
  if (!v) return null;
  const s = String(v).trim().toLowerCase();
  return s === '' ? null : s;
}

function phonesOf(r: any): string[] {
  return [normPhone(r.mobile_number_1), normPhone(r.mobile_number_2)].filter((v): v is string => !!v);
}

function emailsOf(r: any): string[] {
  return [normEmail(r.official_email), normEmail(r.personal_email_1), normEmail(r.personal_email_2)].filter((v): v is string => !!v);
}

// True if two incoming rows (neither yet in the DB) share a phone or email —
// used only for same-file containment, so it stays deterministic (no AI).
function sameContact(a: any, b: any): boolean {
  if (phonesOf(a).some(p => phonesOf(b).includes(p))) return true;
  if (emailsOf(a).some(e => emailsOf(b).includes(e))) return true;
  return false;
}

// Incoming non-empty values overwrite base; empty/missing values keep base's.
function mergeNonEmpty(base: any, incoming: any): any {
  const out = { ...base };
  for (const [k, v] of Object.entries(incoming)) {
    if (k === 'unique_id' || k === 'org_id' || k === 'created_by') continue;
    if (v !== null && v !== undefined && String(v).trim() !== '') out[k] = v;
  }
  return out;
}

const NAME_VERIFY_SYSTEM_PROMPT = 'You verify whether two contact records in a B2B data repository refer to the same real person. Both records already share the same normalised full name. Two records sharing a name may be the same person re-entered under a different Unique ID, or two different people who happen to share a common name. Use company, designation, department and city as supporting evidence: the same person usually keeps a consistent employer/role/location across uploads; two different people with the same name usually differ on at least one. Treat blank fields on either side as unknown, not as a mismatch. Respond ONLY with JSON of the exact shape {"results": [{"idx": <int>, "same_person": <true|false>}, ...]}, one entry per idx given, no prose.';

function parseVerifyResults(text: string): Set<number> {
  const confirmed = new Set<number>();
  const clean = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const parsed = JSON.parse(clean);
  for (const r of parsed.results || []) {
    if (r.same_person === true) confirmed.add(Number(r.idx));
  }
  return confirmed;
}

// Returns null (not an empty Set) on failure, so the caller can tell
// "verified, nobody matched" apart from "couldn't verify, try the backup".
async function callGroqVerify(items: any[]): Promise<Set<number> | null> {
  const groqKey = Deno.env.get('GROQ_API_KEY');
  if (!groqKey) return null;
  try {
    const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: NAME_VERIFY_SYSTEM_PROMPT },
          { role: 'user', content: JSON.stringify(items) },
        ],
      }),
    });
    if (!resp.ok) {
      console.error('[AI-DEDUPE] Groq verification failed:', resp.status, await resp.text());
      return null;
    }
    const data = await resp.json();
    return parseVerifyResults(data.choices[0].message.content);
  } catch (e) {
    console.error('[AI-DEDUPE] Groq verification error:', e);
    return null;
  }
}

// Backup for when Groq is down/unconfigured/rate-limited.
async function callHaikuVerify(items: any[]): Promise<Set<number> | null> {
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!anthropicKey) return null;
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: HAIKU_MODEL,
        max_tokens: 1024,
        system: NAME_VERIFY_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: JSON.stringify(items) }],
      }),
    });
    if (!resp.ok) {
      console.error('[AI-DEDUPE] Haiku verification failed:', resp.status, await resp.text());
      return null;
    }
    const data = await resp.json();
    return parseVerifyResults(data.content[0].text);
  } catch (e) {
    console.error('[AI-DEDUPE] Haiku verification error:', e);
    return null;
  }
}

// One call verifies every name-only candidate pair in the batch at once.
// Groq first, Claude Haiku as backup if Groq is unavailable or errors.
// Fails closed: if both are unavailable, nothing is confirmed and those
// rows fall through to "new" rather than risk merging two different people.
async function verifySamePersonBatch(
  pairs: Array<{ idx: number; incoming: any; candidate: any }>
): Promise<Set<number>> {
  if (pairs.length === 0) return new Set();

  const items = pairs.map(p => ({
    idx: p.idx,
    person_a: {
      name: p.incoming.full_name || '',
      company: p.incoming.company_name || '',
      designation: p.incoming.designation || '',
      department: p.incoming.department || '',
      city: p.incoming.city || '',
    },
    person_b: {
      name: p.candidate.full_name || '',
      company: p.candidate.company_name || '',
      designation: p.candidate.designation || '',
      department: p.candidate.department || '',
      city: p.candidate.city || '',
    },
  }));

  const groqResult = await callGroqVerify(items);
  if (groqResult) return groqResult;

  console.warn('[AI-DEDUPE] Groq unavailable, falling back to Haiku');
  const haikuResult = await callHaikuVerify(items);
  if (haikuResult) return haikuResult;

  console.error('[AI-DEDUPE] Both Groq and Haiku verification failed; treating all as not-same-person');
  return new Set();
}

async function processFerventBatch(
  supabase: any,
  importJob: ImportJob,
  rawBatch: any[],
  batchNumber: number
): Promise<{ inserted: number; updated: number; skipped: number; dbErrors?: number; duplicateSamples?: Array<{ matched_on: string; value: string }>; dbErrorSamples?: Array<{ row?: number; field?: string; message: string; sample?: string }> }> {
  const duplicateSamples: Array<{ matched_on: string; value: string }> = [];
  const dbErrorSamples: Array<{ row?: number; field?: string; message: string; sample?: string }> = [];

  // Rows carrying a Unique ID go through the existing ON CONFLICT upsert. A
  // single upsert can't touch the same conflict key twice, so if the same
  // Unique ID appears more than once in this batch, keep only the last
  // occurrence (latest upload wins).
  const withUid: any[] = [];
  const withoutUid: any[] = [];
  for (const record of rawBatch) {
    const uid = record.unique_id && String(record.unique_id).trim() !== '' ? String(record.unique_id) : null;
    if (uid) { record.unique_id = uid; withUid.push(record); } else withoutUid.push(record);
  }
  const lastIndexForId = new Map<string, number>();
  withUid.forEach((r, idx) => lastIndexForId.set(r.unique_id, idx));
  const dedupedWithUid = withUid.filter((r, idx) => lastIndexForId.get(r.unique_id) === idx);
  let inBatchCollisions = withUid.length - dedupedWithUid.length;

  // --- Duplicate containment for rows with no Unique ID ---
  const mergesByTarget = new Map<string, { target_id: string; record: any }>();
  const newRows: any[] = [];

  if (withoutUid.length > 0) {
    const candidateInput = withoutUid.map((r, idx) => ({
      idx,
      full_name: r.full_name,
      mobile_number_1: r.mobile_number_1,
      mobile_number_2: r.mobile_number_2,
      official_email: r.official_email,
      personal_email_1: r.personal_email_1,
      personal_email_2: r.personal_email_2,
    }));

    const { data: candidates, error: candErr } = await supabase.rpc('find_fervent_duplicate_candidates', {
      p_org_id: importJob.org_id,
      p_records: candidateInput,
    });
    if (candErr) console.error('[AI-DEDUPE] find_fervent_duplicate_candidates failed:', candErr);

    const byIdx = new Map<number, any[]>();
    for (const c of candidates || []) {
      if (!byIdx.has(c.incoming_idx)) byIdx.set(c.incoming_idx, []);
      byIdx.get(c.incoming_idx)!.push(c);
    }

    const claimedTargets = new Set<string>();
    const nameOnlyChecks: Array<{ idx: number; incoming: any; candidate: any }> = [];

    withoutUid.forEach((record, idx) => {
      const cands = byIdx.get(idx) || [];
      const strong = cands.find((c: any) => (c.match_type === 'phone' || c.match_type === 'email') && !claimedTargets.has(c.existing_record.id));
      if (strong) {
        claimedTargets.add(strong.existing_record.id);
        const existingEntry = mergesByTarget.get(strong.existing_record.id);
        mergesByTarget.set(strong.existing_record.id, {
          target_id: strong.existing_record.id,
          record: mergeNonEmpty(existingEntry?.record || {}, record),
        });
        return;
      }
      const nameMatch = cands.find((c: any) => c.match_type === 'name' && !claimedTargets.has(c.existing_record.id));
      if (nameMatch) {
        nameOnlyChecks.push({ idx, incoming: record, candidate: nameMatch.existing_record });
        return;
      }
      newRows.push(record);
    });

    if (nameOnlyChecks.length > 0) {
      const confirmed = await verifySamePersonBatch(nameOnlyChecks);
      for (const check of nameOnlyChecks) {
        const targetId = check.candidate.id;
        if (confirmed.has(check.idx) && !claimedTargets.has(targetId)) {
          claimedTargets.add(targetId);
          const existingEntry = mergesByTarget.get(targetId);
          mergesByTarget.set(targetId, {
            target_id: targetId,
            record: mergeNonEmpty(existingEntry?.record || {}, check.incoming),
          });
        } else {
          newRows.push(check.incoming);
        }
      }
    }
  }

  // Same person appearing twice in one file, neither instance already in the
  // DB: fold the later row into the earliest one (phone/email exact only —
  // no AI call for this tier, it's just intra-file hygiene).
  const foldedNew: any[] = [];
  let foldedCount = 0;
  for (const record of newRows) {
    const matchIdx = foldedNew.findIndex(existing => sameContact(existing, record));
    if (matchIdx >= 0) {
      foldedNew[matchIdx] = mergeNonEmpty(foldedNew[matchIdx], record);
      foldedCount++;
      if (duplicateSamples.length < 20) duplicateSamples.push({ matched_on: 'same file', value: record.full_name || '' });
    } else {
      foldedNew.push(record);
    }
  }

  let mergedCount = 0;
  if (mergesByTarget.size > 0) {
    const merges = Array.from(mergesByTarget.values());
    const { data: mergeResult, error: mergeErr } = await supabase.rpc('merge_fervent_repository_batch', {
      p_org_id: importJob.org_id,
      p_import_job_id: importJob.id,
      p_merges: merges,
    });
    if (mergeErr) {
      console.error('[AI-DEDUPE] merge_fervent_repository_batch failed:', mergeErr);
      dbErrorSamples.push({ field: 'merge', message: mergeErr.message, sample: '' });
    } else {
      mergedCount = mergeResult ?? 0;
    }
  }

  // Genuinely new rows get a system-assigned Unique ID, then flow through the
  // same ON CONFLICT upsert as rows that arrived with one.
  if (foldedNew.length > 0) {
    const { data: newIds, error: idErr } = await supabase.rpc('generate_fervent_unique_ids', {
      p_org_id: importJob.org_id,
      p_count: foldedNew.length,
    });
    if (idErr || !newIds || newIds.length !== foldedNew.length) {
      console.error('[AI-DEDUPE] generate_fervent_unique_ids failed:', idErr);
      foldedNew.forEach((rec: any) => {
        dbErrorSamples.push({ field: 'unique_id', message: idErr?.message || 'id generation failed', sample: rec.full_name || '' });
      });
    } else {
      foldedNew.forEach((record, i) => { record.unique_id = newIds[i]; });
      dedupedWithUid.push(...foldedNew);
    }
  }

  let insertedCount = 0;
  let updatedCount = 0;
  let dbErrorCount = 0;

  if (dedupedWithUid.length > 0) {
    const { data: upsertResult, error: upsertError } = await supabase.rpc('upsert_fervent_repository_batch', {
      p_org_id: importJob.org_id,
      p_created_by: importJob.user_id,
      p_import_job_id: importJob.id,
      p_records: dedupedWithUid,
    });

    if (!upsertError) {
      const row = Array.isArray(upsertResult) ? upsertResult[0] : upsertResult;
      insertedCount = row?.inserted_count ?? 0;
      updatedCount = row?.updated_count ?? 0;
    } else {
      // The whole-batch upsert failed — most likely one bad row in this
      // batch (e.g. a value Postgres can't cast). Don't let that take the
      // rest of the batch down with it: retry one row at a time and only
      // exclude the row(s) that actually fail.
      console.error(`[DB] Batch ${batchNumber} upsert failed as a whole, retrying row-by-row:`, upsertError);
      for (const rec of dedupedWithUid) {
        const { data: rowResult, error: rowError } = await supabase.rpc('upsert_fervent_repository_batch', {
          p_org_id: importJob.org_id,
          p_created_by: importJob.user_id,
          p_import_job_id: importJob.id,
          p_records: [rec],
        });
        if (rowError) {
          dbErrorCount++;
          if (dbErrorSamples.length < 20) {
            dbErrorSamples.push({ field: 'unique_id', message: rowError.message, sample: String(rec.unique_id ?? '') });
          }
          continue;
        }
        const rowRow = Array.isArray(rowResult) ? rowResult[0] : rowResult;
        insertedCount += rowRow?.inserted_count ?? 0;
        updatedCount += rowRow?.updated_count ?? 0;
      }
    }
  }

  updatedCount += mergedCount;
  const skippedCount = inBatchCollisions + foldedCount;

  console.log(`[DB] Fervent batch ${batchNumber}: ${insertedCount} inserted, ${updatedCount} updated (${mergedCount} via AI containment merge), ${skippedCount} folded/collided in-file, ${dbErrorCount} row errors`);
  return { inserted: insertedCount, updated: updatedCount, skipped: skippedCount, dbErrors: dbErrorCount, duplicateSamples, dbErrorSamples };
}