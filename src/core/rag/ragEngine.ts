import { App, TFile, Notice, requestUrl } from 'obsidian'

import { QueryProgressState } from '../../components/chat-view/QueryProgress'
import { VectorManager } from '../../database/modules/vector/VectorManager'
import { SelectEmbedding } from '../../database/schema'
import { NeuralComposerSettings } from '../../settings/schema/setting.types'
import { EmbeddingModelClient } from '../../types/embedding'

import { getEmbeddingModelClient } from './embedding'

// Interface for internal results to avoid 'any'
interface RagResult extends Partial<SelectEmbedding> {
    id: number;
    model?: string;
    path: string;
    content: string;
    similarity: number;
    mtime?: number;
    metadata?: {
        startLine: number;
        endLine: number;
        fileName?: string;
        content?: string;
    };
}

export class RAGEngine {
  private app: App
  private settings: NeuralComposerSettings
  private vectorManager: VectorManager | null = null
  private embeddingModel: EmbeddingModelClient | null = null
  private restartServerCallback: () => Promise<void>;

  constructor(
    app: App,
    settings: NeuralComposerSettings,
    vectorManager: VectorManager,
    restartServerCallback?: () => Promise<void> 
  ) {
    this.app = app
    this.settings = settings
    this.vectorManager = vectorManager
    // Fix: Explicitly handle the promise in the default callback
    this.restartServerCallback = restartServerCallback || (() => Promise.resolve()); 
    this.embeddingModel = getEmbeddingModelClient({
      settings,
      embeddingModelId: settings.embeddingModelId,
    })
  }

  cleanup() {
    this.embeddingModel = null
    this.vectorManager = null
  }

  setSettings(settings: NeuralComposerSettings) {
    this.settings = settings
    this.embeddingModel = getEmbeddingModelClient({
      settings,
      embeddingModelId: settings.embeddingModelId,
    })
  }

  // Removed async keyword to avoid 'Async method has no await'
  // Returns Promise<void> directly
  updateVaultIndex(
    options: { reindexAll: boolean } = { reindexAll: false },
    onQueryProgressChange?: (queryProgress: QueryProgressState) => void,
  ): Promise<void> {
    if (!this.embeddingModel) return Promise.reject(new Error('Embedding model is not set'));
    // Placeholder implementation
    return Promise.resolve();
  }

  // --- 1. TEXT INGESTION ---
  async insertDocument(content: string, description?: string): Promise<boolean> {
    const safeName = description && description.trim() ? description : `Note_${Date.now()}.md`;
    try {
      const response = await requestUrl({
          url: "http://localhost:9621/documents/texts",
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ "texts": [content], "file_sources": [safeName] }),
          throw: false 
      });

      if (response.status >= 400) {
        throw new Error(`Error ${response.status}: ${response.text}`);
      }
      return true;
    } catch (error) {
      console.error("❌ Error in input of text:", error);
      new Notice(`Error saving to the graph: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  // --- 2. BINARY INGESTION (Manual Multipart) ---
  async uploadDocument(file: TFile): Promise<boolean> {
    try {
      const fileData = await this.app.vault.readBinary(file);
      
      // 1. Create Multipart Boundary
      const boundary = "----ObsidianBoundary" + Date.now().toString(16);
      
      // 2. Build Header and Footer
      const prePart = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`;
      const postPart = `\r\n--${boundary}--\r\n`;

      // 3. Merge into Uint8Array
      const preBuffer = new TextEncoder().encode(prePart);
      const postBuffer = new TextEncoder().encode(postPart);
      const bodyBuffer = new Uint8Array(preBuffer.length + fileData.byteLength + postBuffer.length);

      bodyBuffer.set(preBuffer, 0);
      bodyBuffer.set(new Uint8Array(fileData), preBuffer.length);
      bodyBuffer.set(postBuffer, preBuffer.length + fileData.byteLength);

      // 4. Send via requestUrl
      const response = await requestUrl({
        url: "http://localhost:9621/documents/upload",
        method: "POST",
        headers: {
            "Content-Type": `multipart/form-data; boundary=${boundary}`
        },
        body: bodyBuffer.buffer, 
        throw: false
      });

      if (response.status >= 400) {
        throw new Error(`Error ${response.status}: ${response.text}`);
      }

      return true;
    } catch (error) {
      console.error("❌ Error uploading file:", error);
      new Notice(`Error uploading ${file.name}: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

// --- 3. MASTER QUERY (PASSTHROUGH) ---
  async processQuery({
    query,
    scope,
    onQueryProgressChange,
  }: {
    query: string
    scope?: {
      files: string[]
      folders: string[]
    }
    onQueryProgressChange?: (queryProgress: QueryProgressState) => void
  }): Promise<
    (Omit<SelectEmbedding, 'embedding'> & {
      similarity: number
    })[]
  > {
    
    // 1. LOCAL STRATEGY
    if (scope && scope.files && scope.files.length > 0) {
        const localResults: RagResult[] = [];
        for (const filePath of scope.files) {
             const file = this.app.vault.getAbstractFileByPath(filePath);
             if (file instanceof TFile) {
                const content = await this.app.vault.read(file);
                localResults.push({
                    id: -1, model: 'local-file', path: filePath, content: content, similarity: 1.0, mtime: file.stat.mtime,
                    metadata: { startLine: 0, endLine: 0, fileName: file.name, content: content }
                });
             }
        }
        onQueryProgressChange?.({ type: 'querying-done', queryResult: [] });
        return localResults as any; // Cast only at return to satisfy legacy interface
    }

    // 2. GLOBAL STRATEGY
    onQueryProgressChange?.({ type: 'querying' })

    const performQuery = async () => {
        const response = await requestUrl({
            url: "http://localhost:9621/query",
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
                query: query, mode: "hybrid", stream: false, only_need_context: false
            }),
            throw: false
        });
        
        if (response.status >= 400) {
            const errorText = response.text;
            
            // Detect common Reranking issues
            if (errorText.toLowerCase().includes("quota") || errorText.toLowerCase().includes("credit") || errorText.toLowerCase().includes("429")) {
                new Notice("⚠️ RERANK ERROR: Quota Exceeded.\nPlease check your Jina/Cohere API Key.", 0);
            }
            else if (errorText.toLowerCase().includes("rerank")) {
                new Notice(`⚠️ Reranking Error: ${errorText}`, 5000);
            }
            
            throw new Error(`Status ${response.status}: ${errorText}`);
        }
        return response.json;
    };

    try {
      let data;
      try {
          data = await performQuery();
      } catch (firstError) {
          // Resurrection Logic
          console.warn("⚠️ First attempt failed...", firstError);
          if (this.settings.enableAutoStartServer) {
              onQueryProgressChange?.({ type: 'querying' }); 
              new Notice("🧠 Waking up the system...");
              await this.restartServerCallback();
              await new Promise(resolve => setTimeout(resolve, 4000));
              data = await performQuery();
          } else {
              throw firstError;
          }
      }

      const results: RagResult[] = [];
      const graphAnswer = typeof data === 'string' ? data : (data.response || "");
      
      let masterContent = graphAnswer;
      if (data.references && Array.isArray(data.references)) {
          masterContent += "\n\n--- ORIGINAL REFERENCES (DATA LAYER) ---\n";
          data.references.forEach((ref: any, index: number) => {
              const docName = ref.file_path || `Source ${index + 1}`;
              masterContent += `[${index + 1}] ${docName}\n`;
          });
      }

      if (masterContent) {
          results.push({
              id: -1, model: 'lightrag-master', path: "🧠 Graph's Memory",
              content: masterContent, similarity: 1.0, mtime: Date.now(),
              metadata: { startLine: 0, endLine: 0, fileName: "GraphAnswer", content: masterContent }
          });
      }

      // Breakdown References
      if (data.references && Array.isArray(data.references)) {
          for (let i = 0; i < data.references.length; i++) {
              const ref = data.references[i];
              const filePath = ref.file_path || `Source #${i+1}`;
              const docName = `[${i + 1}] ${filePath}`; 
              results.push({
                  id: -(i + 2), model: 'lightrag-ref', path: `📂 ${docName}`,
                  content: `[Full Content of ${docName}]:\n${ref.content || "..."}`, 
                  similarity: 0.5, mtime: Date.now(),
                  metadata: { startLine: 0, endLine: 0, fileName: filePath }
              });
          }
      }

      onQueryProgressChange?.({ type: 'querying-done', queryResult: [] })
      return results as any;

    } catch (error: unknown) {
      console.error("❌ Final error:", error);
      
      // Safe error message extraction
      const message = error instanceof Error ? error.message : String(error);
      
      // Friendly chat error
      const errorDoc: RagResult = {
          id: -2, path: "⚠️ Query Error",
          content: `No response could be obtained from Graph.\n\nPossible cause: ${message}\n\nIf you use Reranking, check your credits.`,
          similarity: 1.0, metadata: { startLine: 0, endLine: 0 }
      };
      return [errorDoc] as any;
    }
  }

  // Marked as private and potentially unused, but keeping it compliant
  private async getQueryEmbedding(query: string): Promise<number[]> {
    if (!this.embeddingModel) throw new Error('Embedding model not set');
    return this.embeddingModel.getEmbedding(query)
  }
}