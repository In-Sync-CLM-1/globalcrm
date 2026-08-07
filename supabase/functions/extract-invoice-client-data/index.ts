import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { encode as base64Encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function fetchFileAsBase64(url: string): Promise<{ base64: string; mimeType: string }> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch file: ${response.status}`);
  }
  
  const arrayBuffer = await response.arrayBuffer();
  const base64 = base64Encode(arrayBuffer);
  
  const contentType = response.headers.get('content-type') || '';
  let mimeType = contentType.split(';')[0].trim();
  
  if (!mimeType || mimeType === 'application/octet-stream') {
    const urlLower = url.toLowerCase();
    if (urlLower.includes('.pdf')) mimeType = 'application/pdf';
    else if (urlLower.includes('.png')) mimeType = 'image/png';
    else if (urlLower.includes('.jpg') || urlLower.includes('.jpeg')) mimeType = 'image/jpeg';
    else if (urlLower.includes('.gif')) mimeType = 'image/gif';
    else if (urlLower.includes('.webp')) mimeType = 'image/webp';
    else mimeType = 'application/pdf';
  }
  
  return { base64, mimeType };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { fileUrl } = await req.json();
    console.log('Extract invoice client data called with:', { fileUrl });

    if (!fileUrl) {
      throw new Error('File URL is required');
    }

    const systemPrompt = `You are a document extraction assistant specialized in extracting client/vendor information and invoice details from invoices, quotations, and similar financial documents.

Extract the following information:

**Client/Customer Information (the party being billed TO):**
- client_company: Company/organization name of the client
- client_name: Contact person name if available
- client_email: Email address
- client_phone: Phone number
- client_address: Full address
- client_gstin: GSTIN/Tax ID if present

**Invoice Details:**
- invoice_number: The invoice or quotation number
- invoice_date: Date of the invoice (format: YYYY-MM-DD)
- due_date: Due date if present (format: YYYY-MM-DD)
- amount: Subtotal/base amount before tax (numeric value only)
- tax_amount: Total tax amount (numeric value only). Sum CGST+SGST if both present.
- total_amount: Grand total including tax (numeric value only)
- currency: Currency code (INR, USD, EUR, etc.)
- description: Brief description of items/services

**Vendor Information (the party issuing the invoice - for context only):**
- vendor_company: Company name of the vendor/seller

**CRITICAL - Date Format Handling:**
Invoices from different regions use different date formats. You MUST correctly interpret dates:
- India, Europe, UK, and most countries use DD/MM/YYYY format
- US documents typically use MM/DD/YYYY format

Use these context clues to determine the date format:
1. If GSTIN is present → Indian document → DD/MM/YYYY
2. If currency is INR or ₹ symbol is used → Indian document → DD/MM/YYYY
3. If address contains Indian states/cities (Mumbai, Delhi, Karnataka, etc.) → DD/MM/YYYY
4. If the first number is > 12, it MUST be the day (e.g., 15/04/2025 = 15th April)
5. When both numbers are ≤ 12 (ambiguous like 01/04/2025), use document context:
   - If any Indian indicators present → interpret as DD/MM/YYYY (1st April)
   - Only if explicit US context → interpret as MM/DD/YYYY

Example date interpretations:
- "01/04/2025" on Indian invoice (has GSTIN/INR) → interpret as 1st April 2025 → output "2025-04-01"
- "15/08/2025" → MUST be 15th August (day=15 > 12) → output "2025-08-15"
- "04/01/2025" on Indian invoice → interpret as 4th January 2025 → output "2025-01-04"

IMPORTANT:
- Focus on extracting the CLIENT/CUSTOMER information (who is being billed), not the vendor
- If you see "Bill To", "Invoice To", "Customer", that's the client information
- Return ONLY a valid JSON object with these exact field names
- Use null for any field that cannot be found
- For phone numbers, include country code if present
- ALWAYS convert dates to YYYY-MM-DD format after correctly interpreting the regional format

Example response:
{
  "client_company": "ABC Corp Pvt Ltd",
  "client_name": "John Doe",
  "client_email": "john@abccorp.com",
  "client_phone": "+91 9876543210",
  "client_address": "123 Main St, Mumbai, MH 400001",
  "client_gstin": "27AABCU9603R1ZM",
  "invoice_number": "INV-2025-001",
  "invoice_date": "2025-01-15",
  "due_date": "2025-02-15",
  "amount": 10000.00,
  "tax_amount": 1800.00,
  "total_amount": 11800.00,
  "currency": "INR",
  "description": "Software development services for Q1 2025",
  "vendor_company": "Your Company Name"
}`;

    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
    if (!ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is not configured');
    }

    console.log('Fetching file and converting to base64...');
    const { base64, mimeType } = await fetchFileAsBase64(fileUrl);
    console.log('File fetched, mime type:', mimeType);

    const isPdf = mimeType === 'application/pdf';

    // 1st choice: Groq. It only accepts image formats — not PDF — so for PDF
    // input we skip straight to Claude Haiku below, which is the only
    // provider here that reads real PDF documents natively. Since almost all
    // documents here are PDFs, Haiku still does most of the real work; Groq
    // picks up the rare image-only upload.
    if (!isPdf) {
      const groqKey = Deno.env.get('GROQ_API_KEY');
      if (groqKey) {
        try {
          const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'meta-llama/llama-4-scout-17b-16e-instruct',
              max_tokens: 4096,
              messages: [
                { role: 'system', content: systemPrompt },
                {
                  role: 'user',
                  content: [
                    { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
                    { type: 'text', text: 'Please extract the client information and invoice details from this document.' },
                  ],
                },
              ],
            }),
          });
          if (groqRes.ok) {
            const groqData = await groqRes.json();
            const content = groqData.choices?.[0]?.message?.content || '';
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              const extractedData = JSON.parse(jsonMatch[0]);
              console.log('Extracted data (Groq):', extractedData);
              return new Response(JSON.stringify({ success: true, extractedData }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              });
            }
          }
        } catch (groqError) {
          console.error('Groq extraction failed, falling back to Haiku:', groqError);
        }
      }
    }

    const documentContent = isPdf
      ? { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: base64 } }
      : { type: 'image' as const, source: { type: 'base64' as const, media_type: mimeType, data: base64 } };

    console.log('Calling Anthropic API...');
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4096,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Please extract the client information and invoice details from this document.'
              },
              documentContent
            ]
          }
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('AI API error:', response.status, errorText);
      
      if (response.status === 429) {
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'Rate limit exceeded. Please try again later.' 
        }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      if (response.status === 402) {
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'AI credits exhausted. Please add credits to continue.' 
        }), {
          status: 402,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      throw new Error(`AI API error: ${response.status}`);
    }

    const data = await response.json();
    console.log('AI response received');
    const content = data.content?.[0]?.text || '';
    
    let extractedData = {};
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        extractedData = JSON.parse(jsonMatch[0]);
        console.log('Extracted data:', extractedData);
      }
    } catch (parseError) {
      console.error('Failed to parse extracted data:', parseError);
      extractedData = { error: 'Could not parse document data' };
    }

    return new Response(JSON.stringify({ 
      success: true, 
      extractedData 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in extract-invoice-client-data:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ 
      success: false, 
      error: errorMessage 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
