import { jsonrepair } from 'jsonrepair';

// LLMs occasionally tack a stray closing quote onto true/false/null literals
// (e.g. `"factionAffiliation": null"`) — jsonrepair can't infer intent there, so strip it first.
export function parseLlmJson<T>(raw: string): T {
  const desanitized = raw.replace(/(:\s*(?:true|false|null))"(?=\s*[,}])/g, '$1');
  return JSON.parse(jsonrepair(desanitized)) as T;
}
