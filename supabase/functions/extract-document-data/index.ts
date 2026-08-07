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
  
  // Determine mime type from URL or content-type header
  const contentType = response.headers.get('content-type') || '';
  let mimeType = contentType.split(';')[0].trim();
  
  // If content-type is not helpful, try to determine from URL
  if (!mimeType || mimeType === 'application/octet-stream') {
    const urlLower = url.toLowerCase();
    if (urlLower.includes('.pdf')) mimeType = 'application/pdf';
    else if (urlLower.includes('.png')) mimeType = 'image/png';
    else if (urlLower.includes('.jpg') || urlLower.includes('.jpeg')) mimeType = 'image/jpeg';
    else if (urlLower.includes('.gif')) mimeType = 'image/gif';
    else if (urlLower.includes('.webp')) mimeType = 'image/webp';
    else mimeType = 'application/pdf'; // Default to PDF for documents
  }
  
  return { base64, mimeType };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { fileUrl, documentType } = await req.json();
    console.log('Extract document data called with:', { fileUrl, documentType });

    if (!fileUrl) {
      throw new Error('File URL is required');
    }

    const systemPrompt = documentType === 'invoice' 
      ? `You are a document extraction assistant. Extract the following fields from this invoice/quotation document:
- invoice_number: The invoice or quotation number
- invoice_date: The date of the invoice (format: YYYY-MM-DD)
- due_date: The due date if present (format: YYYY-MM-DD)
- amount: The subtotal or base amount before tax (numeric value only, no currency symbols)
- tax_amount: The tax/GST amount (numeric value only, no currency symbols). If there's CGST and SGST, add them together.
- currency: The currency code (INR, USD, EUR, etc.)
- notes: Any important notes or description

Return ONLY a valid JSON object with these exact field names. If a field cannot be found, use null.
Example: {"invoice_number": "INV-001", "invoice_date": "2025-01-15", "due_date": "2025-02-15", "amount": 1000.00, "tax_amount": 180.00, "currency": "INR", "notes": "Payment for services"}`
      : `You are a document extraction assistant. Extract the following fields from this document:
- document_name: A suitable name for this document
- document_type: The type (contract, proposal, agreement, specification, report, other)
- description: A brief description of the document content

Return ONLY a valid JSON object with these exact field names. If a field cannot be found, use null.
Example: {"document_name": "Service Agreement 2025", "document_type": "agreement", "description": "Annual service maintenance agreement"}`;

    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
    if (!ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is not configured');
    }

    // Fetch file and convert to base64
    console.log('Fetching file and converting to base64...');
    const { base64, mimeType } = await fetchFileAsBase64(fileUrl);
    console.log('File fetched, mime type:', mimeType);

    // Build the content block based on mime type (document for PDFs, image for images)
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
                    { type: 'text', text: 'Please extract the data from this document.' },
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
        system: systemPrompt,
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: [
              documentContent,
              {
                type: 'text',
                text: 'Please extract the data from this document.'
              }
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
    
    // Parse the JSON from the response
    let extractedData = {};
    try {
      // Try to extract JSON from the response (might be wrapped in markdown code blocks)
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
    console.error('Error in extract-document-data:', error);
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
