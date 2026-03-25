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

const EDIT_INSTRUCTION = (prompt: string) =>
  [
    `IN-PLACE EDIT. User wants: "${prompt}".`,
    `Input PNG is the current canvas selection (one rectangle).`,
    `CRITICAL RULES:`,
    `1) Preserve the existing scene pixel-perfect everywhere.`,
    `2) Only add the requested object/changes described by the prompt.`,
    `3) Do NOT redraw or replace the subject (e.g., do not generate a new dog).`,
    `4) Do NOT change the dog’s face, fur pattern, eyes, pose, or the background.`,
    `5) If the added object might not fit, scale it down so it stays fully visible inside the image edges with a clear margin.`,
    `6) The added object should look naturally attached/occluding (as if it was always there), with consistent lighting and texture.`,
    `Forbidden: any visible guides like borders, rectangles, masks, dashed lines, stickers, polaroids, picture-in-picture, or timestamps.`,
    `Forbidden: typography or UI text.`,
    `Output: one PNG covering the entire rectangle. Everything not described by the prompt must remain unchanged.`,
  ].join(' ');

/**
 * Generate or edit an image using Gemini's native generateContent API.
 * Image part first, then instruction (full-repaint semantics).
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
    // Image first: establish "this is the canvas to replace", then instruction
    parts.push({
      inline_data: {
        mime_type: 'image/png',
        data: contextImageBase64,
      },
    });
    parts.push({
      text: EDIT_INSTRUCTION(prompt),
    });
  } else {
    parts.push({
      text: `Generate an image: ${prompt}. Do not include any text or typography in the image.`,
    });
  }

  const body = {
    contents: [{ parts }],
    generationConfig: {
      responseModalities: ['IMAGE'],
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

  for (const part of responseParts) {
    if (part.text) {
      console.log('  Gemini text response:', part.text.substring(0, 200));
    }
  }

  throw new Error('No image found in Gemini response parts');
}
