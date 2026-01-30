#!/usr/bin/env node

// This script uses a configurable LLM backend for naming tag clusters.
// Configure via environment variables:
//   LLM_PROVIDER: 'local' | 'openrouter' | 'openai' | 'anthropic' (default: 'local')
//   LLM_BASE_URL: API endpoint (default: 'http://localhost:11434/v1' for Ollama)
//   LLM_MODEL: Model name (default depends on provider)
//   LLM_API_KEY: API key if required
import { query, extractJSON, printConfig } from './llm_client.ts';
import * as fs from 'fs/promises';

interface TagCluster {
  id: number;
  name: string;
  tags: string[];
  exemplars: string[];
}

interface ClusterNaming {
  id: number;
  oldName: string;
  newName: string;
  reasoning: string;
}

// Get random sample of tags from cluster
function getRandomSample(tags: string[], count: number): string[] {
  if (tags.length <= count) return tags;

  const shuffled = [...tags].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

async function generateClusterNames(clusters: TagCluster[]): Promise<ClusterNaming[]> {
  console.log(`\n🤖 Using Claude to generate cluster names for ${clusters.length} clusters...`);

  const namings: ClusterNaming[] = [];

  // Process in batches of 5 to avoid overwhelming the API
  const BATCH_SIZE = 5;
  for (let i = 0; i < clusters.length; i += BATCH_SIZE) {
    const batch = clusters.slice(i, Math.min(i + BATCH_SIZE, clusters.length));

    console.log(`\nProcessing clusters ${i} to ${Math.min(i + BATCH_SIZE, clusters.length) - 1}...`);

    // Get random sample of 25 tags for each cluster
    const clusterSamples = batch.map(cluster => ({
      id: cluster.id,
      currentName: cluster.name,
      totalTags: cluster.tags.length,
      sampleTags: getRandomSample(cluster.tags, 25)
    }));

    const prompt = `You are analyzing clusters of semantically similar tags from a document analysis system.

For each cluster below, provide a concise category name (1-3 words, title case) that best represents the theme.

Clusters to name:

${clusterSamples.map(sample => `
Cluster ${sample.id}:
- Current name: ${sample.currentName}
- Total tags in cluster: ${sample.totalTags}
- Random sample of tags: ${sample.sampleTags.join(', ')}
`).join('\n')}

IMPORTANT: Category names must be 1-3 words only (e.g., "Legal Proceedings", "Travel", "Financial Transactions").

Respond in JSON format as an array:
[
  {
    "id": cluster_id,
    "newName": "Category Name",
    "reasoning": "Brief explanation"
  }
]`;

    try {
      const response = await query(prompt, {
        maxTokens: 4096,
      });

      // Extract JSON from response (might be wrapped in markdown code blocks)
      const jsonText = extractJSON(response.content);
      if (!jsonText) {
        console.error('Failed to parse JSON from response');
        console.error('Response:', response.content);
        continue;
      }

      const batchNamings = JSON.parse(jsonText) as Omit<ClusterNaming, 'oldName'>[];

      // Add old names and merge
      for (const naming of batchNamings) {
        const cluster = batch.find(c => c.id === naming.id);
        if (cluster) {
          namings.push({
            ...naming,
            oldName: cluster.name
          });
          console.log(`  ✓ Cluster ${naming.id}: "${cluster.name}" → "${naming.newName}"`);
        }
      }

      // Small delay between batches
      if (i + BATCH_SIZE < clusters.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

    } catch (error) {
      console.error(`Error processing batch ${i}-${i + BATCH_SIZE}:`, error);
      // Continue with next batch
    }
  }

  return namings;
}

async function main() {
  console.log('📚 Loading cluster data...');

  // Print LLM configuration
  printConfig();

  const clustersJson = await fs.readFile('tag_clusters.json', 'utf-8');
  const clusters = JSON.parse(clustersJson) as TagCluster[];

  console.log(`Found ${clusters.length} clusters`);
  console.log(`Total tags across all clusters: ${clusters.reduce((sum, c) => sum + c.tags.length, 0)}`);

  // Generate new names using Claude
  const namings = await generateClusterNames(clusters);

  console.log(`\n✅ Generated names for ${namings.length} clusters`);

  // Update cluster names in the data
  const updatedClusters = clusters.map(cluster => {
    const naming = namings.find(n => n.id === cluster.id);
    if (naming) {
      return {
        ...cluster,
        name: naming.newName
      };
    }
    return cluster;
  });

  // Save updated clusters
  await fs.writeFile(
    'tag_clusters.json',
    JSON.stringify(updatedClusters, null, 2)
  );

  console.log('\n✅ Updated tag_clusters.json with new names');

  // Save naming report
  const report = {
    timestamp: new Date().toISOString(),
    totalClusters: clusters.length,
    namesGenerated: namings.length,
    namings: namings.map(n => ({
      id: n.id,
      oldName: n.oldName,
      newName: n.newName,
      reasoning: n.reasoning
    }))
  };

  await fs.writeFile(
    'cluster_naming_report.json',
    JSON.stringify(report, null, 2)
  );

  console.log('✅ Saved naming report to cluster_naming_report.json');

  // Print summary
  console.log('\n📊 Summary of changes:');
  for (const naming of namings) {
    console.log(`\nCluster ${naming.id}:`);
    console.log(`  Old: "${naming.oldName}"`);
    console.log(`  New: "${naming.newName}"`);
    console.log(`  Why: ${naming.reasoning}`);
  }

  console.log('\n✅ Cluster naming complete!');
  console.log('💡 Restart the API server to load the new cluster names');
}

main().catch(console.error);
