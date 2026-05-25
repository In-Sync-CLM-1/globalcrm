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

// Special mapping for inventory columns to handle variations in CSV headers
function mapInventoryColumn(normalizedHeader: string): string {
  const inventoryColumnMap: Record<string, string> = {
    'item_id__sku': 'item_id_sku',
    'item_id': 'item_id_sku',
    'sku': 'item_id_sku',
    'item_name__description': 'item_name',
    'item_name': 'item_name',
    'name': 'item_name',
    'available_quantity': 'available_qty',
    'quantity': 'available_qty',
    'qty': 'available_qty',
    'unit_of_measure_uom': 'uom',
    'unit': 'uom',
    'pending_po': 'pending_po',
    'pending_purchase_order': 'pending_po',
    'pending_so': 'pending_so',
    'pending_sales_order': 'pending_so',
    'selling_price_inr': 'selling_price',
    'selling_price': 'selling_price',
    'price': 'selling_price',
    'amount': 'amount',
    'total': 'amount'
  };
  
  return inventoryColumnMap[normalizedHeader] || normalizedHeader;
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

    // Validate row count for redefine_repository before processing
    const dataRowCount = lines.length - 1; // Exclude header row
    if (importJob.import_type === 'redefine_repository' && dataRowCount > 5000) {
      throw new Error('CSV file contains too many rows. Maximum allowed is 5,000 records.');
    }

    // Parse headers
    await updateJobStage(supabase, importJobId, 'validating', {
      message: 'Validating CSV structure...',
      file_size_kb: fileSizeKB
    });

    const headers = parseCSVLine(lines[0]).map(h => {
      const normalized = normalizeHeader(h);
      return importJob.import_type === 'inventory' ? mapInventoryColumn(normalized) : normalized;
    });
    console.log('[PARSE] Headers detected:', headers);
    
    // Validate org for redefine_repository ONCE before processing
    if (importJob.import_type === 'redefine_repository') {
      const { data: org } = await supabase
        .from('organizations')
        .select('slug')
        .eq('id', importJob.org_id)
        .single();
      
      if (org?.slug !== 'redefine-marcom-pvt-ltd') {
        throw new Error('This import type is exclusive to Redefine organization');
      }
      console.log('[VALIDATE] Organization validated for redefine repository');
    }

    // Validate required columns based on import type
    let requiredColumns: string[];
    switch (importJob.import_type) {
      case 'contacts':
        requiredColumns = ['first_name', 'email'];
        break;
      case 'redefine_repository':
        requiredColumns = ['name'];
        break;
      case 'inventory':
        requiredColumns = ['item_id_sku'];
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
        } else if (importJob.import_type === 'redefine_repository') {
          // No validation needed here - already validated once at start
          record = {
            org_id: importJob.org_id,
            name: row.name,
            designation: row.designation || null,
            department: row.deppt || row.department || null,
            job_level: row.job_levelupdated || row.job_level_updated || row.job_level || null,
            linkedin_url: row.linkedin || null,
            mobile_number: row.mobilenumb || row.mobile_number || null,
            mobile_2: row.mobile2 || null,
            official_email: row.official || null,
            personal_email: row.personalemailid || row.personal_email || null,
            generic_email: row.generic_email_id || row.generic_email || null,
            industry_type: row.industry_type || null,
            sub_industry: row.sub_industry || null,
            company_name: row.company_name || null,
            address: row.address || null,
            location: row.location || null,
            city: row.city || null,
            state: row.state || null,
            zone: row.zone || null,
            tier: row.tier || null,
            pincode: row.pincode || null,
            website: row.website || null,
            turnover: row.turnover || null,
            employee_size: row.emp_size || row.employee_size || null,
            erp_name: row.erp_name || null,
            erp_vendor: row.erp_vendor || null,
            created_by: importJob.user_id
          };
        } else if (importJob.import_type === 'inventory') {
          // Simplified inventory structure
          record = {
            org_id: importJob.org_id,
            item_id_sku: row.item_id_sku || row.item_id,
            item_name: row.item_name || row.name || null,
            available_qty: row.available_qty ? parseFloat(row.available_qty) : 0,
            uom: row.uom || null,
            pending_po: row.pending_po ? parseInt(row.pending_po) : 0,
            pending_so: row.pending_so ? parseInt(row.pending_so) : 0,
            selling_price: row.selling_price || row.price ? parseFloat(row.selling_price || row.price) : null,
            amount: row.amount ? parseFloat(row.amount) : 0,
            created_by: importJob.user_id,
            import_job_id: importJobId
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
          
          if (result.skipped > 0) {
            console.log(`[BATCH] Skipped ${result.skipped} duplicate records in batch ${batchNumber}`);
          }
          
          batch = [];

          // Update progress after each batch WITH error details for real-time visibility
          await updateJobProgress(supabase, importJobId, {
            total_rows: totalRows,
            processed_rows: processedRows,
            success_count: successCount,
            error_count: errorCount,
            error_details: errors.slice(-100), // Save last 100 errors in real-time
            current_stage: 'inserting',
            stage_details: {
              message: `Inserted batch ${batchNumber} (${successCount} records inserted, ${errorCount} errors)`,
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
      error_details: errors.slice(-500), // Store up to 500 errors for better debugging
      completed_at: new Date().toISOString(),
      file_cleaned_up: !deleteError,
      file_cleanup_at: new Date().toISOString(),
      stage_details: {
        message: `Import completed in ${duration}s`,
        total_success: successCount,
        total_errors: errorCount
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
): Promise<{ inserted: number; skipped: number }> {
  console.log('[DB] Inserting batch', batchNumber, 'with', batch.length, 'records');

  try {
    let tableName: string;
    let upsertOptions: any = {};
    let skippedCount = 0;

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
    } else if (importJob.import_type === 'redefine_repository') {
      tableName = 'redefine_data_repository';
      
      // Collect both official_email and personal_email for duplicate checking
      const officialEmails = batch
        .map(r => r.official_email)
        .filter(email => email && email.trim() !== '');
      
      const personalEmails = batch
        .map(r => r.personal_email)
        .filter(email => email && email.trim() !== '');
      
      const allEmails = [...new Set([...officialEmails, ...personalEmails])];
      
      if (allEmails.length > 0) {
        // Check which emails already exist in the database (both fields)
        const { data: existingByOfficial } = await supabase
          .from('redefine_data_repository')
          .select('official_email')
          .eq('org_id', importJob.org_id)
          .in('official_email', allEmails);

        const { data: existingByPersonal } = await supabase
          .from('redefine_data_repository')
          .select('personal_email')
          .eq('org_id', importJob.org_id)
          .in('personal_email', allEmails);

        const existingOfficialEmails = new Set(
          (existingByOfficial || []).map((r: any) => r.official_email?.toLowerCase())
        );
        
        const existingPersonalEmails = new Set(
          (existingByPersonal || []).map((r: any) => r.personal_email?.toLowerCase())
        );

        // Track emails in current batch to detect within-batch duplicates
        const batchOfficialEmails = new Set<string>();
        const batchPersonalEmails = new Set<string>();
        
        const originalLength = batch.length;
        batch = batch.filter(record => {
          const officialEmail = record.official_email?.toLowerCase();
          const personalEmail = record.personal_email?.toLowerCase();
          
          // Check official_email duplicates
          if (officialEmail && officialEmail !== '') {
            if (existingOfficialEmails.has(officialEmail) || batchOfficialEmails.has(officialEmail)) {
              return false; // Skip duplicate official email
            }
            batchOfficialEmails.add(officialEmail);
          }
          
          // Check personal_email duplicates
          if (personalEmail && personalEmail !== '') {
            if (existingPersonalEmails.has(personalEmail) || batchPersonalEmails.has(personalEmail)) {
              return false; // Skip duplicate personal email
            }
            batchPersonalEmails.add(personalEmail);
          }
          
          return true;
        });

        skippedCount = originalLength - batch.length;
        
        if (batch.length === 0) {
          console.log(`[DB] Batch ${batchNumber}: All ${originalLength} records are duplicates, skipping`);
          return { inserted: 0, skipped: originalLength };
        }

        if (skippedCount > 0) {
          console.log(`[DB] Batch ${batchNumber}: Filtered ${skippedCount} duplicates (by official_email and personal_email), inserting ${batch.length} records`);
        }
      }
      
      upsertOptions = {};
    } else if (importJob.import_type === 'inventory') {
      tableName = 'inventory_items';
      
      // Deduplicate by SKU within the batch
      const deduped = [];
      const seen = new Set();
      for (let i = batch.length - 1; i >= 0; i--) {
        const record = batch[i];
        if (!seen.has(record.item_id_sku)) {
          seen.add(record.item_id_sku);
          deduped.unshift(record);
        }
      }
      batch = deduped;
      
      // Use composite key for upsert (org_id + item_id_sku - column order matters!)
      upsertOptions = {
        onConflict: 'org_id,item_id_sku',
        ignoreDuplicates: false
      };
    } else {
      throw new Error(`Unknown import type: ${importJob.import_type}`);
    }

    // Add import_job_id to inventory items for precise rollback tracking
    if (importJob.import_type === 'inventory') {
      batch = batch.map(record => ({ ...record, import_job_id: importJob.id }));
    }

    // Use insert for redefine_repository and contacts, upsert for campaign recipients
    const { error } = (importJob.import_type === 'redefine_repository' || importJob.import_type === 'contacts')
      ? await supabase.from(tableName).insert(batch)
      : await supabase.from(tableName).upsert(batch, upsertOptions);

    if (error) {
      console.error('[DB] Batch insert failed:', error);
      throw error;
    }

    console.log('[DB] Batch', batchNumber, 'inserted successfully');
    return { inserted: batch.length, skipped: skippedCount };
  } catch (error) {
    console.error('[DB] Batch processing error:', error);
    throw error;
  }
}