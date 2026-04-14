import { GoogleGenerativeAI } from '@google/generative-ai';
import * as dotenv from 'dotenv';

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

export async function extractMatchDataWithAI(screenshotBase64: string, prompt: string) {
  const result = await model.generateContent([
    prompt,
    {
      inlineData: {
        data: screenshotBase64,
        mimeType: 'image/png'
      }
    }
  ]);

  const response = await result.response;
  const text = response.text();
  
  // Try to parse JSON from the response
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.error('Failed to parse Gemini response as JSON:', text);
  }
  return text;
}
