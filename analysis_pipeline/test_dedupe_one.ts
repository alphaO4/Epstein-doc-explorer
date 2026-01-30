// Test script for LLM-based entity deduplication
// Configure via environment variables:
//   LLM_PROVIDER: 'local' | 'openrouter' | 'openai' | 'anthropic' (default: 'local')
//   LLM_BASE_URL: API endpoint (default: 'http://localhost:11434/v1' for Ollama)
//   LLM_MODEL: Model name (default depends on provider)
//   LLM_API_KEY: API key if required
import { query, extractJSON, printConfig } from './llm_client.ts';

async function testOneGroup() {
  // Print LLM configuration
  printConfig();

  const testNames = ['Jeffrey Epstein', 'Jeffrey E.', 'Jeff Epstein', 'J. Epstein'];

  const prompt = `Analyze these entity names and determine which should be merged (same person) vs kept separate (different people).

RULES:
- DO merge: name variations, nicknames, case differences (Jeffrey Epstein = Jeff Epstein = jeffrey epstein)
- DO NOT merge: numbered entities (Jane Doe 1 ≠ Jane Doe 2), family members (George H.W. Bush ≠ George W. Bush), generic vs specific (Jeffrey ≠ Jeffrey Epstein)

Names (${testNames.length} total):
${testNames.map((n, i) => `${i + 1}. ${n}`).join('\n')}

Return ONLY valid JSON with this exact structure:
{
  "merge_groups": [
    {"canonical": "Best Full Name", "aliases": ["variant1", "variant2"], "reasoning": "why same person"}
  ],
  "do_not_merge": ["name1"],
  "reasoning_for_no_merge": "why separate"
}

If no merges needed, use empty array: {"merge_groups": [], "do_not_merge": ${JSON.stringify(testNames)}, "reasoning_for_no_merge": "all distinct"}`;

  console.log('=== Testing Single Group ===\n');
  console.log('Names:', testNames);
  console.log('\nSending prompt to LLM...\n');

  try {
    console.log('Collecting response...\n');
    const response = await query(prompt, {
      maxTokens: 4096,
    });

    const responseText = response.content;

    console.log('\n=== Response Text ===');
    console.log(responseText);
    console.log('\n=== Attempting JSON Extraction ===');

    if (!responseText) {
      console.log('ERROR: No response text found!');
      return;
    }

    // Try to extract JSON
    const jsonText = extractJSON(responseText);
    if (!jsonText) {
      console.log('ERROR: No JSON found in response');
      return;
    }

    console.log('\nExtracted JSON:');
    console.log(jsonText);

    const parsed = JSON.parse(jsonText.trim());
    console.log('\n=== Parsed Result ===');
    console.log(JSON.stringify(parsed, null, 2));

    console.log('\n✓ Success! Merge groups:', parsed.merge_groups?.length || 0);
  } catch (error) {
    console.error('\n✗ Error:', error);
  }
}

testOneGroup().catch(console.error);
