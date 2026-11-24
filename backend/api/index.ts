/**
 * Vercel entry (staging). The whole Express app runs as one Vercel Function (Fluid compute).
 * All paths are rewritten here by vercel.json; report generation runs after the response via waitUntil.
 */
import { createApp } from '../src/http/createApp';

export default createApp();
