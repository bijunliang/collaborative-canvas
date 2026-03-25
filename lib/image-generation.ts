const COMETAPI_BASE_URL = 'https://api.cometapi.com';
const MODEL = 'gemini-2.5-flash-image';

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: GeminiPart[];
    };
  }>;
}

/**
 * Generate or edit an image using Gemini's native generateContent API.
 * When contextImageBase64 is provided (raw base64, no data: prefix),
 * the image is sent as inline_data for proper inpainting/editing.
 */
export async function generateImage(
  prompt: string,
  contextImageBase64?: string
): Promise<string> {
  const apiKey = process.env.COMETAPI_KEY;
  if (!apiKey) {
    throw new Error('COMETAPI_KEY is not set');
  }

  const parts: Array<Record<string, unknown>> = [];

  if (contextImageBase64) {
    parts.push({
      text: [
        `Edit this image to add: "${prompt}".`,
        `The "${prompt}" must fit fully within the image with comfortable margin from all edges.`,
        `Preserve the existing content, style, lighting, and composition as closely as possible.`,
        `Only add what the prompt describes. The result should look like a natural, seamless edit.`,
      ].join(' '),
    });
    parts.push({
      inline_data: {
        mime_type: 'image/png',
        data: contextImageBase64,
      },
    });
  } else {
    parts.push({ text: `Generate an image: ${prompt}` });
  }

  const body = {
    contents: [{ parts }],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
    },
  };

  const endpoint = `${COMETAPI_BASE_URL}/v1beta/models/${MODEL}:generateContent`;
  console.log(`  📡 Gemini native API call (hasContext: ${!!contextImageBase64})`);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gemini API error: ${response.status} - ${error}`);
  }

  const data: GeminiResponse = await response.json();

  console.log(
    'Gemini response keys:',
    JSON.stringify(Object.keys(data)),
    'candidates:',
    data.candidates?.length ?? 0
  );

  const candidates = data.candidates;
  if (!candidates || candidates.length === 0) {
    console.error('No candidates in response:', JSON.stringify(data).substring(0, 500));
    throw new Error('No candidates in Gemini response');
  }

  const responseParts = candidates[0].content?.parts;
  if (!responseParts || responseParts.length === 0) {
    console.error('No parts in candidate:', JSON.stringify(candidates[0]).substring(0, 500));
    throw new Error('No parts in Gemini response candidate');
  }

  for (const part of responseParts) {
    if (part.inlineData?.data) {
      console.log(`  ✅ Got image from Gemini (${(part.inlineData.data.length / 1024).toFixed(0)} KB base64)`);
      const mimeType = part.inlineData.mimeType || 'image/png';
      return `data:${mimeType};base64,${part.inlineData.data}`;
    }
  }

  // Log text parts for debugging
  for (const part of responseParts) {
    if (part.text) {
      console.log('  Gemini text response:', part.text.substring(0, 200));
    }
  }

  throw new Error('No image found in Gemini response parts');
}
