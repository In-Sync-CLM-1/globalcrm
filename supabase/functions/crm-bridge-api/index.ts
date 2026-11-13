import { getSupabaseClient } from '../_shared/supabaseClient.ts';
import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-api-key',
};

interface RequestContext {
  apiKey: string;
  orgId: string;
  apiKeyId: string;
  startTime: number;
}

// Rate limiting: track requests per API key
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const requestId = crypto.randomUUID();

  try {
    // Initialize Supabase client with service role
    const supabaseAdmin = getSupabaseClient();

    // Authenticate request
    const apiKey = req.headers.get('x-api-key');
    if (!apiKey) {
      return errorResponse('Missing API key', 401, requestId);
    }

    // Verify API key
    const { data: keyData, error: keyError } = await supabaseAdmin
      .from('api_keys')
      .select('id, org_id, permissions, is_active, expires_at')
      .eq('api_key', apiKey)
      .single();

    if (keyError || !keyData) {
      await logUsage(supabaseAdmin, null, null, req, 401, Date.now() - startTime, 'Invalid API key');
      return errorResponse('Invalid API key', 401, requestId);
    }

    if (!keyData.is_active) {
      await logUsage(supabaseAdmin, keyData.id, keyData.org_id, req, 403, Date.now() - startTime, 'API key is inactive');
      return errorResponse('API key is inactive', 403, requestId);
    }

    if (keyData.expires_at && new Date(keyData.expires_at) < new Date()) {
      await logUsage(supabaseAdmin, keyData.id, keyData.org_id, req, 403, Date.now() - startTime, 'API key has expired');
      return errorResponse('API key has expired', 403, requestId);
    }

    // Check rate limit
    const rateLimitCheck = checkRateLimit(apiKey);
    if (!rateLimitCheck.allowed) {
      await logUsage(supabaseAdmin, keyData.id, keyData.org_id, req, 429, Date.now() - startTime, 'Rate limit exceeded');
      return errorResponse('Rate limit exceeded', 429, requestId);
    }

    const context: RequestContext = {
      apiKey,
      orgId: keyData.org_id,
      apiKeyId: keyData.id,
      startTime
    };

    // Update last_used_at
    await supabaseAdmin
      .from('api_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', keyData.id);

    // Route to appropriate handler
    const url = new URL(req.url);
    const path = url.pathname.replace('/crm-bridge-api', '');
    const method = req.method;

    // Debug logging
    console.log('Request details:', {
      fullUrl: req.url,
      pathname: url.pathname,
      extractedPath: path,
      method: method
    });

    let response: Response;

    if (path === '/contacts' && method === 'GET') {
      response = await handleListContacts(supabaseAdmin, context, url);
    } else if (path.match(/^\/contacts\/[^/]+$/) && method === 'GET') {
      const contactId = path.split('/')[2];
      response = await handleGetContact(supabaseAdmin, context, contactId);
    } else if (path === '/contacts' && method === 'POST') {
      response = await handleCreateContact(supabaseAdmin, context, req);
    } else if (path.match(/^\/contacts\/[^/]+$/) && method === 'PATCH') {
      const contactId = path.split('/')[2];
      response = await handleUpdateContact(supabaseAdmin, context, req, contactId);
    } else if (path.match(/^\/contacts\/[^/]+\/activities$/) && method === 'GET') {
      const contactId = path.split('/')[2];
      response = await handleGetContactActivities(supabaseAdmin, context, contactId);
    } else if (path.match(/^\/contacts\/[^/]+\/activities$/) && method === 'POST') {
      const contactId = path.split('/')[2];
      response = await handleCreateActivity(supabaseAdmin, context, req, contactId);
    } else if (path === '/pipeline-stages' && method === 'GET') {
      response = await handleGetPipelineStages(supabaseAdmin, context);
    } else if (path === '/custom-fields' && method === 'GET') {
      response = await handleGetCustomFields(supabaseAdmin, context);
    } else if (path === '/approval-types' && method === 'GET') {
      response = await handleListApprovalTypes(supabaseAdmin, context, url);
    } else if (path.match(/^\/approval-types\/[^/]+$/) && method === 'GET') {
      const typeId = path.split('/')[2];
      response = await handleGetApprovalType(supabaseAdmin, context, typeId);
    } else if (path === '/approval-rules' && method === 'GET') {
      response = await handleListApprovalRules(supabaseAdmin, context, url);
    } else if (path.match(/^\/approval-rules\/[^/]+$/) && method === 'GET') {
      const ruleId = path.split('/')[2];
      response = await handleGetApprovalRule(supabaseAdmin, context, ruleId);
    } else if (path === '/approval-rules/evaluate' && method === 'GET') {
      response = await handleEvaluateApprovalRule(supabaseAdmin, context, url);
    } else if (path === '/users' && method === 'GET') {
      response = await handleListUsers(supabaseAdmin, context, url);
    } else if (path.match(/^\/users\/[^/]+$/) && method === 'GET') {
      const userId = path.split('/')[2];
      response = await handleGetUser(supabaseAdmin, context, userId);
    } else if (path.match(/^\/users\/[^/]+$/) && method === 'PATCH') {
      const userId = path.split('/')[2];
      response = await handleUpdateUser(supabaseAdmin, context, req, userId);
    } else if (path.match(/^\/users\/[^/]+\/roles$/) && method === 'GET') {
      const userId = path.split('/')[2];
      response = await handleGetUserRoles(supabaseAdmin, context, userId);
    } else if (path === '/roles' && method === 'GET') {
      response = await handleListRoles(supabaseAdmin, context);
    } else if (path.match(/^\/users\/[^/]+\/roles$/) && method === 'POST') {
      const userId = path.split('/')[2];
      response = await handleAssignRole(supabaseAdmin, context, req, userId);
    } else if (path.match(/^\/users\/[^/]+\/roles\/[^/]+$/) && method === 'DELETE') {
      const userId = path.split('/')[2];
      const roleId = path.split('/')[4];
      response = await handleRemoveRole(supabaseAdmin, context, userId, roleId);
    } else if (path === '/designations' && method === 'GET') {
      response = await handleListDesignations(supabaseAdmin, context, url);
    } else if (path.match(/^\/designations\/[^/]+$/) && method === 'GET') {
      const designationId = path.split('/')[2];
      response = await handleGetDesignation(supabaseAdmin, context, designationId);
    } else if (path === '/designations' && method === 'POST') {
      response = await handleCreateDesignation(supabaseAdmin, context, req);
    } else if (path.match(/^\/designations\/[^/]+$/) && method === 'PATCH') {
      const designationId = path.split('/')[2];
      response = await handleUpdateDesignation(supabaseAdmin, context, req, designationId);
    } else if (path.match(/^\/designations\/[^/]+$/) && method === 'DELETE') {
      const designationId = path.split('/')[2];
      response = await handleDeleteDesignation(supabaseAdmin, context, designationId);
    } else if (path.match(/^\/designations\/[^/]+\/features$/) && method === 'GET') {
      const designationId = path.split('/')[2];
      response = await handleGetDesignationFeatures(supabaseAdmin, context, designationId);
    } else if (path.match(/^\/designations\/[^/]+\/features$/) && method === 'PATCH') {
      const designationId = path.split('/')[2];
      response = await handleUpdateDesignationFeatures(supabaseAdmin, context, req, designationId);
    } else if (path === '/blog-posts' && method === 'GET') {
      response = await handleListBlogPosts(supabaseAdmin, context, url);
    } else if (path === '/blog-posts' && method === 'POST') {
      response = await handleCreateBlogPost(supabaseAdmin, context, req);
    } else if (path.match(/^\/blog-posts\/[^/]+$/) && method === 'PUT') {
      const blogId = path.split('/')[2];
      response = await handleUpdateBlogPost(supabaseAdmin, context, req, blogId);
    } else if (path === '/organizations' && method === 'GET') {
      response = await handleGetOrganization(supabaseAdmin, context);
    } else {
      response = errorResponse('Endpoint not found', 404, requestId);
    }

    // Extract status from response
    const responseStatus = response.status;
    const responseTime = Date.now() - startTime;

    // Log the request
    await logUsage(supabaseAdmin, context.apiKeyId, context.orgId, req, responseStatus, responseTime);

    return response;

  } catch (error) {
    console.error('CRM Bridge API error:', error);
    const responseTime = Date.now() - startTime;
    return errorResponse(error instanceof Error ? error.message : 'Internal server error', 500, requestId);
  }
});

// Rate limiting: 100 requests per minute
function checkRateLimit(apiKey: string): { allowed: boolean; resetIn?: number } {
  const now = Date.now();
  const limit = rateLimitMap.get(apiKey);

  if (!limit || now > limit.resetTime) {
    rateLimitMap.set(apiKey, { count: 1, resetTime: now + 60000 });
    return { allowed: true };
  }

  if (limit.count >= 100) {
    return { allowed: false, resetIn: Math.ceil((limit.resetTime - now) / 1000) };
  }

  limit.count++;
  return { allowed: true };
}

async function logUsage(
  supabase: any,
  apiKeyId: string | null,
  orgId: string | null,
  req: Request,
  statusCode: number,
  responseTime: number,
  errorMessage?: string
) {
  if (!apiKeyId || !orgId) return;

  const url = new URL(req.url);
  const endpoint = url.pathname.replace('/crm-bridge-api', '');

  try {
    // Parse IP address to get the first IP from x-forwarded-for header
    const rawIp = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip');
    const ipAddress = rawIp ? rawIp.split(',')[0].trim() : null;
    
    await supabase.from('api_key_usage_logs').insert({
      api_key_id: apiKeyId,
      org_id: orgId,
      endpoint,
      method: req.method,
      status_code: statusCode,
      response_time_ms: responseTime,
      ip_address: ipAddress,
      user_agent: req.headers.get('user-agent'),
      error_message: errorMessage
    });
  } catch (error) {
    console.error('Failed to log usage:', error);
  }
}

function successResponse(data: any, requestId: string, status = 200): Response {
  return new Response(
    JSON.stringify({
      success: true,
      data,
      meta: {
        timestamp: new Date().toISOString(),
        request_id: requestId
      }
    }),
    {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    }
  );
}

function errorResponse(message: string, status: number, requestId: string): Response {
  return new Response(
    JSON.stringify({
      success: false,
      error: {
        code: getErrorCode(status),
        message
      },
      meta: {
        timestamp: new Date().toISOString(),
        request_id: requestId
      }
    }),
    {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    }
  );
}

function getErrorCode(status: number): string {
  const codes: Record<number, string> = {
    400: 'BAD_REQUEST',
    401: 'UNAUTHORIZED',
    403: 'FORBIDDEN',
    404: 'NOT_FOUND',
    429: 'RATE_LIMIT_EXCEEDED',
    500: 'INTERNAL_SERVER_ERROR'
  };
  return codes[status] || 'UNKNOWN_ERROR';
}

// Handler functions

async function handleListContacts(supabase: any, context: RequestContext, url: URL) {
  const limit = parseInt(url.searchParams.get('limit') || '50');
  const offset = parseInt(url.searchParams.get('offset') || '0');
  const status = url.searchParams.get('status');
  const assignedTo = url.searchParams.get('assigned_to');
  const createdAfter = url.searchParams.get('created_after');
  const search = url.searchParams.get('search');

  let query = supabase
    .from('contacts')
    .select('id, first_name, last_name, email, phone, company, job_title, status, source, pipeline_stage_id, created_at, updated_at', { count: 'exact' })
    .eq('org_id', context.orgId)
    .range(offset, offset + limit - 1)
    .order('created_at', { ascending: false });

  if (status) query = query.eq('status', status);
  if (assignedTo) query = query.eq('assigned_to', assignedTo);
  if (createdAfter) query = query.gte('created_at', createdAfter);
  if (search) {
    query = query.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,email.ilike.%${search}%,company.ilike.%${search}%`);
  }

  const { data, error, count } = await query;

  if (error) {
    return errorResponse(error.message, 500, crypto.randomUUID());
  }

  return successResponse({
    contacts: data,
    pagination: {
      total: count,
      limit,
      offset,
      has_more: count ? offset + limit < count : false
    }
  }, crypto.randomUUID());
}

async function handleGetContact(supabase: any, context: RequestContext, contactId: string) {
  const { data: contact, error } = await supabase
    .from('contacts')
    .select('*, contact_emails(*), contact_phones(*)')
    .eq('org_id', context.orgId)
    .eq('id', contactId)
    .single();

  if (error) {
    return errorResponse('Contact not found', 404, crypto.randomUUID());
  }

  return successResponse(contact, crypto.randomUUID());
}

// Validation schema for contact creation
const createContactSchema = z.object({
  first_name: z.string().trim().min(1, 'First name is required').max(100, 'First name too long'),
  last_name: z.string().trim().max(100, 'Last name too long').optional(),
  email: z.string().email('Invalid email format').max(255, 'Email too long').optional().or(z.literal('')),
  phone: z.string().regex(/^[\d\s+()-]*$/, 'Invalid phone format').max(20, 'Phone too long').optional().or(z.literal('')),
  company: z.string().trim().max(200, 'Company name too long').optional(),
  job_title: z.string().trim().max(200, 'Job title too long').optional(),
  status: z.string().max(50).optional(),
  source: z.string().max(100).optional(),
  address: z.string().max(500, 'Address too long').optional(),
  city: z.string().max(100, 'City name too long').optional(),
  state: z.string().max(100, 'State name too long').optional(),
  country: z.string().max(100, 'Country name too long').optional(),
  postal_code: z.string().max(20, 'Postal code too long').optional(),
  website: z.string().url('Invalid website URL').max(500).optional().or(z.literal('')),
  linkedin_url: z.string().url('Invalid LinkedIn URL').max(500).optional().or(z.literal('')),
  notes: z.string().max(5000, 'Notes too long').optional()
});

async function handleCreateContact(supabase: any, context: RequestContext, req: Request) {
  const body = await req.json();

  // Validate input
  try {
    const validatedData = createContactSchema.parse(body);
    
    const { data, error } = await supabase
      .from('contacts')
      .insert({
        org_id: context.orgId,
        first_name: validatedData.first_name,
        last_name: validatedData.last_name,
        email: validatedData.email || null,
        phone: validatedData.phone || null,
        company: validatedData.company,
        job_title: validatedData.job_title,
        status: validatedData.status || 'new',
        source: validatedData.source || 'api',
        address: validatedData.address,
        city: validatedData.city,
        state: validatedData.state,
        country: validatedData.country,
        postal_code: validatedData.postal_code,
        website: validatedData.website || null,
        linkedin_url: validatedData.linkedin_url || null,
        notes: validatedData.notes
      })
      .select()
      .single();

    if (error) {
      console.error('Database error creating contact:', error);
      return errorResponse('Failed to create contact', 400, crypto.randomUUID());
    }

    return successResponse(data, crypto.randomUUID(), 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const messages = error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
      return errorResponse(`Validation failed: ${messages}`, 400, crypto.randomUUID());
    }
    throw error;
  }
}

// Validation schema for contact updates - all fields optional
const updateContactSchema = z.object({
  first_name: z.string().trim().min(1, 'First name cannot be empty').max(100, 'First name too long').optional(),
  last_name: z.string().trim().max(100, 'Last name too long').optional(),
  email: z.string().email('Invalid email format').max(255, 'Email too long').optional().or(z.literal('')),
  phone: z.string().regex(/^[\d\s+()-]*$/, 'Invalid phone format').max(20, 'Phone too long').optional().or(z.literal('')),
  company: z.string().trim().max(200, 'Company name too long').optional(),
  job_title: z.string().trim().max(200, 'Job title too long').optional(),
  status: z.string().max(50).optional(),
  address: z.string().max(500, 'Address too long').optional(),
  city: z.string().max(100, 'City name too long').optional(),
  state: z.string().max(100, 'State name too long').optional(),
  country: z.string().max(100, 'Country name too long').optional(),
  postal_code: z.string().max(20, 'Postal code too long').optional(),
  website: z.string().url('Invalid website URL').max(500).optional().or(z.literal('')),
  linkedin_url: z.string().url('Invalid LinkedIn URL').max(500).optional().or(z.literal('')),
  notes: z.string().max(5000, 'Notes too long').optional(),
  assigned_to: z.string().uuid('Invalid user ID').optional(),
  pipeline_stage_id: z.string().uuid('Invalid stage ID').optional()
}).strict(); // Prevent arbitrary fields

async function handleUpdateContact(supabase: any, context: RequestContext, req: Request, contactId: string) {
  const body = await req.json();

  // Validate input
  try {
    const validatedData = updateContactSchema.parse(body);

    // Only update fields that were provided
    const updateData: any = {};
    Object.keys(validatedData).forEach(key => {
      if (validatedData[key as keyof typeof validatedData] !== undefined) {
        updateData[key] = validatedData[key as keyof typeof validatedData] === '' ? null : validatedData[key as keyof typeof validatedData];
      }
    });

    const { data, error } = await supabase
      .from('contacts')
      .update(updateData)
      .eq('org_id', context.orgId)
      .eq('id', contactId)
      .select()
      .single();

    if (error) {
      console.error('Database error updating contact:', error);
      return errorResponse('Failed to update contact', 400, crypto.randomUUID());
    }

    return successResponse(data, crypto.randomUUID());
  } catch (error) {
    if (error instanceof z.ZodError) {
      const messages = error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
      return errorResponse(`Validation failed: ${messages}`, 400, crypto.randomUUID());
    }
    throw error;
  }
}

async function handleGetContactActivities(supabase: any, context: RequestContext, contactId: string) {
  const { data, error } = await supabase
    .from('contact_activities')
    .select('*')
    .eq('org_id', context.orgId)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: false });

  if (error) {
    return errorResponse(error.message, 500, crypto.randomUUID());
  }

  return successResponse({ activities: data }, crypto.randomUUID());
}

async function handleCreateActivity(supabase: any, context: RequestContext, req: Request, contactId: string) {
  const body = await req.json();

  const { data, error } = await supabase
    .from('contact_activities')
    .insert({
      org_id: context.orgId,
      contact_id: contactId,
      activity_type: body.activity_type,
      subject: body.subject,
      description: body.description,
      scheduled_at: body.scheduled_at,
      completed_at: body.completed_at
    })
    .select()
    .single();

  if (error) {
    return errorResponse(error.message, 400, crypto.randomUUID());
  }

  return successResponse(data, crypto.randomUUID(), 201);
}

async function handleGetPipelineStages(supabase: any, context: RequestContext) {
  const { data, error } = await supabase
    .from('pipeline_stages')
    .select('*')
    .eq('org_id', context.orgId)
    .order('stage_order', { ascending: true });

  if (error) {
    return errorResponse(error.message, 500, crypto.randomUUID());
  }

  return successResponse({ stages: data }, crypto.randomUUID());
}

async function handleGetCustomFields(supabase: any, context: RequestContext) {
  const { data, error } = await supabase
    .from('custom_fields')
    .select('*')
    .eq('org_id', context.orgId)
    .eq('is_active', true)
    .order('field_order', { ascending: true });

  if (error) {
    return errorResponse(error.message, 500, crypto.randomUUID());
  }

  return successResponse({ custom_fields: data }, crypto.randomUUID());
}

// Organization Handler

async function handleGetOrganization(supabase: any, context: RequestContext) {
  const { data, error } = await supabase
    .from('organizations')
    .select(`
      id,
      name,
      slug,
      logo_url,
      primary_color,
      settings,
      usage_limits,
      subscription_active,
      services_enabled,
      max_automation_emails_per_day,
      apollo_config,
      created_at,
      updated_at
    `)
    .order('name', { ascending: true });

  if (error) {
    return errorResponse(error.message, 500, crypto.randomUUID());
  }

  return successResponse({ organizations: data }, crypto.randomUUID());
}

// Approval Matrix Handlers

async function handleListApprovalTypes(supabase: any, context: RequestContext, url: URL) {
  const isActive = url.searchParams.get('is_active');

  let query = supabase
    .from('approval_types')
    .select('*')
    .eq('org_id', context.orgId)
    .order('name', { ascending: true });

  if (isActive !== null) {
    query = query.eq('is_active', isActive === 'true');
  }

  const { data, error } = await query;

  if (error) {
    return errorResponse(error.message, 500, crypto.randomUUID());
  }

  return successResponse({ approval_types: data }, crypto.randomUUID());
}

async function handleGetApprovalType(supabase: any, context: RequestContext, typeId: string) {
  const { data, error } = await supabase
    .from('approval_types')
    .select('*')
    .eq('org_id', context.orgId)
    .eq('id', typeId)
    .single();

  if (error || !data) {
    return errorResponse('Approval type not found', 404, crypto.randomUUID());
  }

  return successResponse(data, crypto.randomUUID());
}

async function handleListApprovalRules(supabase: any, context: RequestContext, url: URL) {
  const limit = parseInt(url.searchParams.get('limit') || '50');
  const offset = parseInt(url.searchParams.get('offset') || '0');
  const approvalTypeId = url.searchParams.get('approval_type_id');
  const isActive = url.searchParams.get('is_active');

  let query = supabase
    .from('approval_rules')
    .select('*, approval_types(id, name, description)', { count: 'exact' })
    .eq('org_id', context.orgId)
    .range(offset, offset + limit - 1)
    .order('threshold_amount', { ascending: true });

  if (approvalTypeId) query = query.eq('approval_type_id', approvalTypeId);
  if (isActive !== null) query = query.eq('is_active', isActive === 'true');

  const { data, error, count } = await query;

  if (error) {
    return errorResponse(error.message, 500, crypto.randomUUID());
  }

  // Map role codes to display labels
  const roleMap: Record<string, string> = {
    'super_admin': 'Super Admin',
    'admin': 'Admin',
    'sales_manager': 'Sales Manager',
    'sales_agent': 'Sales Agent',
    'support_manager': 'Support Manager',
    'support_agent': 'Support Agent',
    'analyst': 'Analyst'
  };

  const formattedData = data?.map((rule: any) => ({
    ...rule,
    approval_flow: rule.required_roles.map((role: string, index: number) => ({
      step: index + 1,
      role: role,
      role_label: roleMap[role] || role
    }))
  }));

  return successResponse({
    approval_rules: formattedData,
    pagination: {
      total: count,
      limit,
      offset,
      has_more: count ? offset + limit < count : false
    }
  }, crypto.randomUUID());
}

async function handleGetApprovalRule(supabase: any, context: RequestContext, ruleId: string) {
  const { data, error } = await supabase
    .from('approval_rules')
    .select('*, approval_types(id, name, description)')
    .eq('org_id', context.orgId)
    .eq('id', ruleId)
    .single();

  if (error || !data) {
    return errorResponse('Approval rule not found', 404, crypto.randomUUID());
  }

  // Map role codes to display labels
  const roleMap: Record<string, string> = {
    'super_admin': 'Super Admin',
    'admin': 'Admin',
    'sales_manager': 'Sales Manager',
    'sales_agent': 'Sales Agent',
    'support_manager': 'Support Manager',
    'support_agent': 'Support Agent',
    'analyst': 'Analyst'
  };

  const formattedData = {
    ...data,
    approval_flow: data.required_roles.map((role: string, index: number) => ({
      step: index + 1,
      role: role,
      role_label: roleMap[role] || role
    }))
  };

  return successResponse(formattedData, crypto.randomUUID());
}

async function handleEvaluateApprovalRule(supabase: any, context: RequestContext, url: URL) {
  const approvalTypeId = url.searchParams.get('approval_type_id');
  const amount = url.searchParams.get('amount');

  if (!approvalTypeId) {
    return errorResponse('approval_type_id is required', 400, crypto.randomUUID());
  }

  let query = supabase
    .from('approval_rules')
    .select('*, approval_types(id, name, description)')
    .eq('org_id', context.orgId)
    .eq('approval_type_id', approvalTypeId)
    .eq('is_active', true)
    .order('threshold_amount', { ascending: true });

  if (amount) {
    const amountValue = parseFloat(amount);
    query = query.lte('threshold_amount', amountValue);
  }

  const { data, error } = await query;

  if (error) {
    return errorResponse(error.message, 500, crypto.randomUUID());
  }

  // Get the highest threshold rule that matches
  const matchingRule = data && data.length > 0 ? data[data.length - 1] : null;

  if (!matchingRule) {
    return successResponse({
      matched: false,
      message: 'No matching approval rule found',
      approval_type_id: approvalTypeId,
      amount: amount ? parseFloat(amount) : null
    }, crypto.randomUUID());
  }

  // Map role codes to display labels
  const roleMap: Record<string, string> = {
    'super_admin': 'Super Admin',
    'admin': 'Admin',
    'sales_manager': 'Sales Manager',
    'sales_agent': 'Sales Agent',
    'support_manager': 'Support Manager',
    'support_agent': 'Support Agent',
    'analyst': 'Analyst'
  };

  const formattedRule = {
    ...matchingRule,
    approval_flow: matchingRule.required_roles.map((role: string, index: number) => ({
      step: index + 1,
      role: role,
      role_label: roleMap[role] || role
    }))
  };

  return successResponse({
    matched: true,
    rule: formattedRule,
    approval_type_id: approvalTypeId,
    amount: amount ? parseFloat(amount) : null
  }, crypto.randomUUID());
}

// Users (Profiles) Handlers

async function handleListUsers(supabase: any, context: RequestContext, url: URL) {
  const limit = parseInt(url.searchParams.get('limit') || '50');
  const offset = parseInt(url.searchParams.get('offset') || '0');
  const designationId = url.searchParams.get('designation_id');
  const isActive = url.searchParams.get('is_active');
  const search = url.searchParams.get('search');

  let query = supabase
    .from('profiles')
    .select(`
      id,
      first_name,
      last_name,
      phone,
      designation_id,
      is_active,
      calling_enabled,
      whatsapp_enabled,
      email_enabled,
      sms_enabled,
      created_at,
      updated_at,
      user_roles(id, role),
      designations(id, name, role)
    `, { count: 'exact' })
    .eq('org_id', context.orgId)
    .range(offset, offset + limit - 1)
    .order('created_at', { ascending: false });

  if (designationId) query = query.eq('designation_id', designationId);
  if (isActive !== null) query = query.eq('is_active', isActive === 'true');
  if (search) {
    query = query.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,phone.ilike.%${search}%`);
  }

  const { data, error, count } = await query;

  if (error) {
    return errorResponse(error.message, 500, crypto.randomUUID());
  }

  const roleMap: Record<string, string> = {
    'super_admin': 'Super Admin',
    'admin': 'Admin',
    'sales_manager': 'Sales Manager',
    'sales_agent': 'Sales Agent',
    'support_manager': 'Support Manager',
    'support_agent': 'Support Agent',
    'analyst': 'Analyst'
  };

  const formattedData = data?.map((user: any) => ({
    ...user,
    roles: user.user_roles?.map((ur: any) => ({
      ...ur,
      role_label: roleMap[ur.role] || ur.role
    }))
  }));

  return successResponse({
    users: formattedData,
    pagination: {
      total: count,
      limit,
      offset,
      has_more: count ? offset + limit < count : false
    }
  }, crypto.randomUUID());
}

async function handleGetUser(supabase: any, context: RequestContext, userId: string) {
  const { data: user, error } = await supabase
    .from('profiles')
    .select(`
      *,
      user_roles(id, role),
      designations(id, name, description, role)
    `)
    .eq('org_id', context.orgId)
    .eq('id', userId)
    .single();

  if (error || !user) {
    return errorResponse('User not found', 404, crypto.randomUUID());
  }

  const roleMap: Record<string, string> = {
    'super_admin': 'Super Admin',
    'admin': 'Admin',
    'sales_manager': 'Sales Manager',
    'sales_agent': 'Sales Agent',
    'support_manager': 'Support Manager',
    'support_agent': 'Support Agent',
    'analyst': 'Analyst'
  };

  const formattedUser = {
    ...user,
    roles: user.user_roles?.map((ur: any) => ({
      ...ur,
      role_label: roleMap[ur.role] || ur.role
    }))
  };

  return successResponse(formattedUser, crypto.randomUUID());
}

async function handleUpdateUser(supabase: any, context: RequestContext, req: Request, userId: string) {
  const body = await req.json();

  // Allowed fields for update
  const allowedFields = ['first_name', 'last_name', 'phone', 'designation_id', 'is_active', 'calling_enabled', 'whatsapp_enabled', 'email_enabled', 'sms_enabled'];
  const updateData: any = {};
  
  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      updateData[field] = body[field];
    }
  }

  const { data, error } = await supabase
    .from('profiles')
    .update(updateData)
    .eq('org_id', context.orgId)
    .eq('id', userId)
    .select()
    .single();

  if (error) {
    return errorResponse(error.message, 400, crypto.randomUUID());
  }

  return successResponse(data, crypto.randomUUID());
}

// User Roles Handlers

async function handleGetUserRoles(supabase: any, context: RequestContext, userId: string) {
  const { data, error } = await supabase
    .from('user_roles')
    .select('*')
    .eq('org_id', context.orgId)
    .eq('user_id', userId);

  if (error) {
    return errorResponse(error.message, 500, crypto.randomUUID());
  }

  const roleMap: Record<string, string> = {
    'super_admin': 'Super Admin',
    'admin': 'Admin',
    'sales_manager': 'Sales Manager',
    'sales_agent': 'Sales Agent',
    'support_manager': 'Support Manager',
    'support_agent': 'Support Agent',
    'analyst': 'Analyst'
  };

  const formattedData = data?.map((ur: any) => ({
    ...ur,
    role_label: roleMap[ur.role] || ur.role
  }));

  return successResponse({ roles: formattedData }, crypto.randomUUID());
}

async function handleListRoles(supabase: any, context: RequestContext) {
  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('id, user_roles(id, role, created_at)')
    .eq('org_id', context.orgId);

  if (error) {
    return errorResponse(error.message, 500, crypto.randomUUID());
  }

  const roleMap: Record<string, string> = {
    'super_admin': 'Super Admin',
    'admin': 'Admin',
    'sales_manager': 'Sales Manager',
    'sales_agent': 'Sales Agent',
    'support_manager': 'Support Manager',
    'support_agent': 'Support Agent',
    'analyst': 'Analyst'
  };

  // Flatten and format all roles
  const allRoles = profiles
    ?.flatMap((p: any) => p.user_roles?.map((ur: any) => ({
      ...ur,
      user_id: p.id,
      role_label: roleMap[ur.role] || ur.role
    })) || []);

  return successResponse({ roles: allRoles }, crypto.randomUUID());
}

async function handleAssignRole(supabase: any, context: RequestContext, req: Request, userId: string) {
  const body = await req.json();
  
  if (!body.role) {
    return errorResponse('Role is required', 400, crypto.randomUUID());
  }

  const { data, error } = await supabase
    .from('user_roles')
    .insert({
      org_id: context.orgId,
      user_id: userId,
      role: body.role
    })
    .select()
    .single();

  if (error) {
    return errorResponse(error.message, 400, crypto.randomUUID());
  }

  return successResponse(data, crypto.randomUUID(), 201);
}

async function handleRemoveRole(supabase: any, context: RequestContext, userId: string, roleId: string) {
  const { error } = await supabase
    .from('user_roles')
    .delete()
    .eq('org_id', context.orgId)
    .eq('user_id', userId)
    .eq('id', roleId);

  if (error) {
    return errorResponse(error.message, 400, crypto.randomUUID());
  }

  return successResponse({ message: 'Role removed successfully' }, crypto.randomUUID());
}

// Designations Handlers

async function handleListDesignations(supabase: any, context: RequestContext, url: URL) {
  const isActive = url.searchParams.get('is_active');

  let query = supabase
    .from('designations')
    .select('*')
    .eq('org_id', context.orgId)
    .order('name', { ascending: true });

  if (isActive !== null) {
    query = query.eq('is_active', isActive === 'true');
  }

  const { data, error } = await query;

  if (error) {
    return errorResponse(error.message, 500, crypto.randomUUID());
  }

  const roleMap: Record<string, string> = {
    'super_admin': 'Super Admin',
    'admin': 'Admin',
    'sales_manager': 'Sales Manager',
    'sales_agent': 'Sales Agent',
    'support_manager': 'Support Manager',
    'support_agent': 'Support Agent',
    'analyst': 'Analyst'
  };

  const formattedData = data?.map((d: any) => ({
    ...d,
    role_label: roleMap[d.role] || d.role
  }));

  return successResponse({ designations: formattedData }, crypto.randomUUID());
}

async function handleGetDesignation(supabase: any, context: RequestContext, designationId: string) {
  const { data, error } = await supabase
    .from('designations')
    .select('*')
    .eq('org_id', context.orgId)
    .eq('id', designationId)
    .single();

  if (error || !data) {
    return errorResponse('Designation not found', 404, crypto.randomUUID());
  }

  const roleMap: Record<string, string> = {
    'super_admin': 'Super Admin',
    'admin': 'Admin',
    'sales_manager': 'Sales Manager',
    'sales_agent': 'Sales Agent',
    'support_manager': 'Support Manager',
    'support_agent': 'Support Agent',
    'analyst': 'Analyst'
  };

  const formattedData = {
    ...data,
    role_label: roleMap[data.role] || data.role
  };

  return successResponse(formattedData, crypto.randomUUID());
}

async function handleCreateDesignation(supabase: any, context: RequestContext, req: Request) {
  const body = await req.json();

  const { data, error } = await supabase
    .from('designations')
    .insert({
      org_id: context.orgId,
      name: body.name,
      description: body.description,
      role: body.role,
      is_active: body.is_active !== undefined ? body.is_active : true
    })
    .select()
    .single();

  if (error) {
    return errorResponse(error.message, 400, crypto.randomUUID());
  }

  return successResponse(data, crypto.randomUUID(), 201);
}

async function handleUpdateDesignation(supabase: any, context: RequestContext, req: Request, designationId: string) {
  const body = await req.json();

  const { data, error } = await supabase
    .from('designations')
    .update(body)
    .eq('org_id', context.orgId)
    .eq('id', designationId)
    .select()
    .single();

  if (error) {
    return errorResponse(error.message, 400, crypto.randomUUID());
  }

  return successResponse(data, crypto.randomUUID());
}

async function handleDeleteDesignation(supabase: any, context: RequestContext, designationId: string) {
  // Soft delete by setting is_active to false
  const { data, error } = await supabase
    .from('designations')
    .update({ is_active: false })
    .eq('org_id', context.orgId)
    .eq('id', designationId)
    .select()
    .single();

  if (error) {
    return errorResponse(error.message, 400, crypto.randomUUID());
  }

  return successResponse({ message: 'Designation deactivated successfully', data }, crypto.randomUUID());
}

// Designation Feature Access Handlers

async function handleGetDesignationFeatures(supabase: any, context: RequestContext, designationId: string) {
  const { data, error } = await supabase
    .from('designation_feature_access')
    .select('*, feature_permissions(feature_key, feature_name, category)')
    .eq('org_id', context.orgId)
    .eq('designation_id', designationId);

  if (error) {
    return errorResponse(error.message, 500, crypto.randomUUID());
  }

  return successResponse({ feature_access: data }, crypto.randomUUID());
}

async function handleUpdateDesignationFeatures(supabase: any, context: RequestContext, req: Request, designationId: string) {
  const body = await req.json();

  if (!body.feature_key) {
    return errorResponse('feature_key is required', 400, crypto.randomUUID());
  }

  // Check if record exists
  const { data: existing } = await supabase
    .from('designation_feature_access')
    .select('id')
    .eq('org_id', context.orgId)
    .eq('designation_id', designationId)
    .eq('feature_key', body.feature_key)
    .single();

  let result;
  if (existing) {
    // Update existing
    const { data, error } = await supabase
      .from('designation_feature_access')
      .update({
        can_view: body.can_view !== undefined ? body.can_view : true,
        can_create: body.can_create !== undefined ? body.can_create : false,
        can_edit: body.can_edit !== undefined ? body.can_edit : false,
        can_delete: body.can_delete !== undefined ? body.can_delete : false,
        custom_permissions: body.custom_permissions || {}
      })
      .eq('id', existing.id)
      .select()
      .single();

    if (error) {
      return errorResponse(error.message, 400, crypto.randomUUID());
    }
    result = data;
  } else {
    // Insert new
    const { data, error } = await supabase
      .from('designation_feature_access')
      .insert({
        org_id: context.orgId,
        designation_id: designationId,
        feature_key: body.feature_key,
        can_view: body.can_view !== undefined ? body.can_view : true,
        can_create: body.can_create !== undefined ? body.can_create : false,
        can_edit: body.can_edit !== undefined ? body.can_edit : false,
        can_delete: body.can_delete !== undefined ? body.can_delete : false,
        custom_permissions: body.custom_permissions || {}
      })
      .select()
      .single();

    if (error) {
      return errorResponse(error.message, 400, crypto.randomUUID());
    }
    result = data;
  }

  return successResponse(result, crypto.randomUUID());
}

// Blog Posts Handlers

async function handleListBlogPosts(supabase: any, context: RequestContext, url: URL) {
  const blog_url = url.searchParams.get('blog_url');
  
  let query = supabase
    .from('blog_posts')
    .select('*')
    .eq('org_id', context.orgId)
    .order('posted_timestamp', { ascending: false });
  
  if (blog_url) {
    query = query.eq('blog_url', blog_url).limit(1);
  }
  
  const { data, error } = await query;
  
  if (error) return errorResponse(error.message, 500, crypto.randomUUID());
  return successResponse({ blog_posts: data }, crypto.randomUUID());
}

async function handleCreateBlogPost(supabase: any, context: RequestContext, req: Request) {
  const body = await req.json();
  
  // Validate required fields
  if (!body.blog_url || !body.blog_title || !body.publish_date) {
    return errorResponse('Missing required fields: blog_url, blog_title, publish_date', 400, crypto.randomUUID());
  }
  
  const { data, error } = await supabase
    .from('blog_posts')
    .insert({
      org_id: context.orgId,
      blog_url: body.blog_url,
      blog_title: body.blog_title,
      blog_excerpt: body.blog_excerpt,
      publish_date: body.publish_date,
      social_posted: body.social_posted || false,
      email_campaign_sent: body.email_campaign_sent || false,
      twitter_url: body.twitter_url,
      linkedin_url: body.linkedin_url,
      facebook_url: body.facebook_url,
      featured_image_url: body.featured_image_url,
      status: body.status || 'posted',
      posted_timestamp: new Date().toISOString()
    })
    .select()
    .single();
  
  if (error) {
    if (error.code === '23505') { // Duplicate key
      return errorResponse('Blog post with this URL already exists', 409, crypto.randomUUID());
    }
    return errorResponse(error.message, 400, crypto.randomUUID());
  }
  
  return successResponse(data, crypto.randomUUID(), 201);
}

async function handleUpdateBlogPost(supabase: any, context: RequestContext, req: Request, blogId: string) {
  const body = await req.json();
  
  const { data, error } = await supabase
    .from('blog_posts')
    .update(body)
    .eq('org_id', context.orgId)
    .eq('id', blogId)
    .select()
    .single();
  
  if (error) return errorResponse(error.message, 400, crypto.randomUUID());
  return successResponse(data, crypto.randomUUID());
}
