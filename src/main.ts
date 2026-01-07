import { Editor, MarkdownView, Notice, Plugin, TFolder, TFile } from 'obsidian'
import { spawn, execSync, ChildProcess } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import * as net from 'net' // <--- ¡NUEVO IMPORT!

import { ApplyView } from './ApplyView'
import { ChatView } from './ChatView'
import { ChatProps } from './components/chat-view/Chat'
import { InstallerUpdateRequiredModal } from './components/modals/InstallerUpdateRequiredModal'
import { APPLY_VIEW_TYPE, CHAT_VIEW_TYPE } from './constants'
import { McpManager } from './core/mcp/mcpManager'
import { RAGEngine } from './core/rag/ragEngine'
import { DatabaseManager } from './database/DatabaseManager'
import {
  NeuralComposerSettings,
  NeuralComposerSettingsSchema,
} from './settings/schema/setting.types'
import { parseNeuralComposerSettings } from './settings/schema/settings'
import { NeuralComposerSettingTab } from './settings/SettingTab'
import { getMentionableBlockData } from './utils/obsidian'

// --- LISTA MAESTRA DE EXTENSIONES ---
const SUPPORTED_EXTENSIONS = [
    'md', 'txt', 'docx', 'pdf', 'pptx', 'xlsx', 'rtf', 'odt', 'epub',
    'html', 'htm', 'xml', 'json', 'yaml', 'yml', 'csv',
    'tex', 'log', 'conf', 'ini', 'properties', 'sql', 'bat', 'sh', 
    'c', 'cpp', 'py', 'java', 'js', 'ts', 'swift', 'go', 'rb', 'php',
    'css', 'scss', 'less'
];

const TEXT_BASED_EXTENSIONS = [
    'md', 'txt', 'html', 'htm', 'xml', 'json', 'yaml', 'yml', 'csv', 
    'tex', 'log', 'conf', 'ini', 'properties', 'sql', 'bat', 'sh', 
    'c', 'cpp', 'py', 'java', 'js', 'ts', 'swift', 'go', 'rb', 'php', 
    'css', 'scss', 'less'
];

export default class NeuralComposerPlugin extends Plugin {
  settings: NeuralComposerSettings
  initialChatProps?: ChatProps 
  settingsChangeListeners: ((newSettings: NeuralComposerSettings) => void)[] = []
  mcpManager: McpManager | null = null
  dbManager: DatabaseManager | null = null
  ragEngine: RAGEngine | null = null
  private dbManagerInitPromise: Promise<DatabaseManager> | null = null
  private ragEngineInitPromise: Promise<RAGEngine> | null = null
  private timeoutIds: ReturnType<typeof setTimeout>[] = []
  private serverProcess: ChildProcess | null = null;
  private lastErrorTime: number = 0; 

async onload() {
    await this.loadSettings()

    this.registerView(CHAT_VIEW_TYPE, (leaf) => new ChatView(leaf, this))
    this.registerView(APPLY_VIEW_TYPE, (leaf) => new ApplyView(leaf))

      this.addRibbonIcon('brain-circuit', 'Open Neural Composer', () =>
      this.openChatView(),
    )

    this.addCommand({
      id: 'open-new-chat',
      name: 'Open chat',
      callback: () => this.openChatView(true),
    })

    this.addCommand({
      id: 'add-selection-to-chat',
      name: 'Add selection to chat',
      editorCallback: (editor: Editor, view: MarkdownView) => {
        this.addSelectionToChat(editor, view)
      },
    })

    // --- CORA MOD: QUICK RESTART COMMAND ---
    this.addCommand({
      id: 'restart-neural-backend',
      name: '♻️ Restart Neural Backend (LightRAG)',
      callback: async () => {
        await this.restartLightRagServer();
      },
    })
    // ---------------------------------------

    // --- CORA MOD: CONTEXT MENU (FOLDERS) ---
    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file) => {
        if (file instanceof TFolder) {
          menu.addItem((item) => {
            item
              .setTitle('🧠 Ingest Folder into Graph')
              .setIcon('layers')
              .onClick(async () => {
                await this.batchIngestFolder(file);
              });
          });
        }
      })
    );

    // --- CORA MOD: SINGLE FILE INGEST COMMAND ---
    this.addCommand({
      id: 'ingest-current-file',
      name: '🧠 Ingest current file into Knowledge Graph',
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || !SUPPORTED_EXTENSIONS.includes(file.extension.toLowerCase())) {
            return false;
        }
        if (checking) return true;

        (async () => {
            const title = file.basename;
            const ext = file.extension.toLowerCase();
            // TRANSLATED NOTICE
            const notice = new Notice(`🧠 Sending "${file.name}" to the system...`, 0);

            try {
                const ragEngine = await this.getRAGEngine();
                let success = false;
                
                if (TEXT_BASED_EXTENSIONS.includes(ext)) {
                     const content = await this.app.vault.read(file);
                     const finalContent = ext === 'md' ? `Title: ${title}\n\n${content}` : content;
                     success = await ragEngine.insertDocument(finalContent, file.name);
                } else {
                     success = await ragEngine.uploadDocument(file);
                }

                if (success) {
                    // TRANSLATED STATUS
                    notice.setMessage(`✅ Sent. Processing in background...`);
                    await this.monitorPipeline(notice);
                } else {
                    notice.setMessage(`❌ Upload failed.`);
                    setTimeout(() => notice.hide(), 5000);
                }
            } catch (error) {
                console.error(error);
                notice.setMessage(`❌ Critical error connecting to backend.`);
                setTimeout(() => notice.hide(), 5000);
            }
        })();
      },
    })

    this.addSettingTab(new NeuralComposerSettingTab(this.app, this))

    // --- AGGRESSIVE AUTO-START (CLEAN SLATE PROTOCOL) ---
    this.app.workspace.onLayoutReady(async () => {
        if (this.settings.enableAutoStartServer) {
            // TRANSLATED LOG
            console.log("⚡ Obsidian ready. Executing Clean Start Protocol...");
            
            // 1. Kill any zombie process
            this.stopLightRagServer();
            
            // 2. Wait for port release
            await new Promise(resolve => setTimeout(resolve, 1500));
            
            // 3. Regenerate .env and start fresh
            this.startLightRagServer();
        }
    });
  }

  // --- LÓGICA DE MONITOREO (TRANSPARENCIA) ---
  async monitorPipeline(notice: Notice) {
    let isBusy = true;
    let errors = 0;
    // Esperar un momento para que el servidor registre la tarea
    await new Promise(r => setTimeout(r, 1000));

    while (isBusy) {
        try {
            const response = await fetch("http://localhost:9621/documents/pipeline_status");
            if (!response.ok) throw new Error("Status error");
            
            const status = await response.json();
            
            // Si hay documentos en cola (docs > 0) y busy es false, puede que haya terminado o no empezado.
            // Pero generalmente 'busy' es el indicador clave.
            isBusy = status.busy;
            
            if (isBusy) {
                const total = status.batchs || 1;
                const current = status.cur_batch || 0;
                const percent = Math.round((current / total) * 100);
                
                notice.setMessage(
                    `🧠 System processing...\n` +
                    `⚙️ Progress: ${percent}% (${current}/${total})\n` +
                    `📝 ${status.latest_message || "Analizing..."}`
                );
            }

            if (!isBusy) break;

            await new Promise(r => setTimeout(r, 1500)); // Polling cada 1.5s

        } catch (e) {
            errors++;
            if (errors > 3) isBusy = false;
            await new Promise(r => setTimeout(r, 2000));
        }
    }
    
    notice.setMessage("🎉 Integrated Knowledge!\nThe graph is up to date.");
    setTimeout(() => notice.hide(), 5000);
  }

  // --- LÓGICA DE BATCH ---
  private getAllSupportedFiles(folder: TFolder): TFile[] {
    let files: TFile[] = [];
    for (const child of folder.children) {
        if (child instanceof TFile) {
            if (SUPPORTED_EXTENSIONS.includes(child.extension.toLowerCase())) {
                files.push(child);
            }
        } else if (child instanceof TFolder) {
            files = files.concat(this.getAllSupportedFiles(child));
        }
    }
    return files;
  }

  async batchIngestFolder(folder: TFolder) {
    const files = this.getAllSupportedFiles(folder);
    if (files.length === 0) {
        new Notice("⚠️ Empty folder or no supported files.");
        return;
    }

    const notice = new Notice(`📦 Sending ${files.length} files to system...`, 0);
    
    try {
        const ragEngine = await this.getRAGEngine();
        let successCount = 0;

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const ext = file.extension.toLowerCase();
            
            notice.setMessage(`📦 Sending (${i + 1}/${files.length}):\n📄 ${file.name}`);
            
            try {
                let result = false;
                if (TEXT_BASED_EXTENSIONS.includes(ext)) {
                    const content = await this.app.vault.read(file);
                    const finalContent = ext === 'md' ? `Title: ${file.basename}\n\n${content}` : content;
                    result = await ragEngine.insertDocument(finalContent, file.name);
                } else {
                    result = await ragEngine.uploadDocument(file);
                }
                
                if (result) successCount++;
                await new Promise(resolve => setTimeout(resolve, 200)); 

            } catch (err) {
                console.error(`Error en ${file.name}:`, err);
            }
        }

        // Una vez enviados, iniciamos el monitoreo del procesamiento real
        notice.setMessage(`✅ Uploaded files (${successCount}).\n🧠 Start processing...`);
        await this.monitorPipeline(notice);

    } catch (error) {
        console.error("Error batch:", error);
        notice.setMessage("❌ Error starting upload.");
        setTimeout(() => notice.hide(), 5000);
    }
  }

  // --- RESTO DEL CÓDIGO (LIFECYCLE, SERVER MANAGE) ---
  
  onunload() {
    this.timeoutIds.forEach((id) => clearTimeout(id))
    this.timeoutIds = []
    this.ragEngine?.cleanup()
    this.ragEngine = null
    this.dbManagerInitPromise = null
    this.ragEngineInitPromise = null
    this.dbManager?.cleanup()
    this.dbManager = null
    this.mcpManager?.cleanup()
    this.mcpManager = null
    this.stopLightRagServer();
  }

  public stopLightRagServer() {
    console.log("🛑 Stopping LightRAG services...");
    if (this.serverProcess) {
        this.serverProcess.kill();
        this.serverProcess = null;
    }
    try {
        if (process.platform === 'win32') {
            execSync('taskkill /F /IM lightrag-server.exe /T', { stdio: 'ignore' });
        }
    } catch (error) {}
  }

  public async restartLightRagServer() {
    new Notice("🔄 Restarting System Backend...");
    this.stopLightRagServer();
    setTimeout(async () => {
        await this.updateEnvFile();
        await this.startLightRagServer();
    }, 2000);
  }

// 1. GENERADOR DE TEXTO (No guarda, solo crea el string)
  public generateEnvConfig(): string {
    const workDir = this.settings.lightRagWorkDir;
    if (!workDir) return "";

    try {
        const targetLlmId = this.settings.lightRagModelId || this.settings.chatModelId;
        const embeddingId = this.settings.embeddingModelId;
        
        const llmModelObj = this.settings.chatModels.find(m => m.id === targetLlmId);
        const embedModelObj = this.settings.embeddingModels.find(m => m.id === embeddingId);

        const llmProvider = this.settings.providers.find(p => p.id === llmModelObj?.providerId);
        const embedProvider = this.settings.providers.find(p => p.id === embedModelObj?.providerId);

        let envContent = `# Generated by Neural Composer\n`;
        envContent += `# You can edit this file manually before restarting.\n\n`;
        
        envContent += `WORKING_DIR=${workDir}\n`;
        envContent += `HOST=0.0.0.0\n`;
        envContent += `PORT=9621\n`;
        envContent += `SUMMARY_LANGUAGE=${this.settings.lightRagSummaryLanguage || 'English'}\n`;
        
        // --- TUS VARIABLES DE TUNING (Agregadas para que el usuario las vea y edite) ---
        envContent += `\n# --- Performance Tuning ---\n`;
        envContent += `MAX_ASYNC=4\n`;
        envContent += `MAX_PARALLEL_INSERT=1\n`; // Conservador por defecto
        envContent += `CHUNK_SIZE=1200\n`;       // Estándar LightRAG
        envContent += `CHUNK_OVERLAP_SIZE=100\n\n`;

        // LLM
        if (llmModelObj && llmProvider) {
            envContent += `# LLM Configuration\n`;
            envContent += `LLM_BINDING=${llmProvider.id}\n`;
            envContent += `LLM_MODEL=${llmModelObj.model}\n`;
            if (llmProvider.id === 'ollama' && llmProvider.baseUrl) envContent += `OLLAMA_HOST=${llmProvider.baseUrl}\n`;
            else if (llmProvider.id === 'openai' && llmProvider.baseUrl?.includes('localhost')) envContent += `OPENAI_BASE_URL=${llmProvider.baseUrl}\n`;
        }

        // Embeddings
        if (embedModelObj && embedProvider) {
            envContent += `\n# Embedding Configuration\n`;
            envContent += `EMBEDDING_BINDING=${embedProvider.id}\n`;
            envContent += `EMBEDDING_MODEL=${embedModelObj.model}\n`;
            envContent += `EMBEDDING_DIM=${embedModelObj.dimension || 1024}\n`;
            envContent += `MAX_TOKEN_SIZE=8192\n`;
        }

        // Rerank (Tu lógica existente)
        const rerankBinding = this.settings.lightRagRerankBinding;
        if (rerankBinding && rerankBinding !== '') {
            envContent += `\n# Reranking Configuration\n`;
            envContent += `RERANK_BINDING=${rerankBinding}\n`;
            envContent += `RERANK_MODEL=${this.settings.lightRagRerankModel}\n`;
            if (rerankBinding === 'jina') envContent += `RERANK_BINDING_HOST=https://api.jina.ai/v1/rerank\n`;
            if (rerankBinding === 'cohere') envContent += `RERANK_BINDING_HOST=https://api.cohere.com/v2/rerank\n`;
            if (this.settings.lightRagRerankApiKey) envContent += `RERANK_BINDING_API_KEY=${this.settings.lightRagRerankApiKey}\n`;
        } else {
             envContent += `\n# Reranking Disabled\n`;
             envContent += `RERANK_BINDING=null\n`;
        }

        // API Keys
        const providersNeeded = new Set([llmProvider, embedProvider]);
        envContent += `\n# API Keys\n`;
        providersNeeded.forEach(p => {
            if (p && p.apiKey) {
                const keyName = p.id.toUpperCase(); 
                if (keyName === 'GEMINI') envContent += `GEMINI_API_KEY=${p.apiKey}\n`;
                if (keyName === 'OPENAI') envContent += `OPENAI_API_KEY=${p.apiKey}\n`;
                if (keyName === 'ANTHROPIC') envContent += `ANTHROPIC_API_KEY=${p.apiKey}\n`;
            }
        });
        
        // Entity Types (Tu lógica existente)
        if (this.settings.useCustomEntityTypes) {
            const rawTypes = this.settings.lightRagEntityTypes;
            if (rawTypes && rawTypes.trim().length > 0) {
                const typeList = rawTypes.split(',').map(t => t.trim()).filter(t => t.length > 0);
                envContent += `\nENTITY_TYPES='${JSON.stringify(typeList)}'\n`;
            }
        }

        return envContent;

    } catch (err) {
        console.error("❌ Error generando config:", err);
        return "";
    }
  }

  // 2. GUARDAR Y REINICIAR (La acción final)
  public async saveEnvAndRestart(content: string) {
      const workDir = this.settings.lightRagWorkDir;
      if (!workDir) return;
      
      try {
          const envPath = path.join(workDir, '.env');
          fs.writeFileSync(envPath, content);
          console.log(`📝 .env guardado manualmente en: ${envPath}`);
          
          // Reiniciar servidor para aplicar cambios
          await this.restartLightRagServer();
          
      } catch (e) {
          new Notice("Error saving .env file");
          console.error(e);
      }
  }

  // 3. ACTUALIZACIÓN AUTOMÁTICA (Compatibilidad hacia atrás)
  // Esta la mantenemos para cuando el usuario cambia settings simples y no quiere abrir el editor
  public async updateEnvFile() {
      const content = this.generateEnvConfig();
      const workDir = this.settings.lightRagWorkDir;
      if (workDir && content) {
          const envPath = path.join(workDir, '.env');
          fs.writeFileSync(envPath, content);
      }
  }

// Función silenciosa para chequear puertos (Sin errores de consola)
  private isPortInUse(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        
        const onError = () => {
            socket.destroy();
            resolve(false); // Si hay error, el puerto está libre (cerrado)
        };

        socket.setTimeout(500); // 500ms de paciencia
        socket.once('error', onError);
        socket.once('timeout', onError);

        socket.connect(port, '127.0.0.1', () => {
            socket.destroy();
            resolve(true); // ¡Conectó! El puerto está ocupado (Server vivo)
        });
    });
  }

async startLightRagServer() {
    const command = this.settings.lightRagCommand;
    const workDir = this.settings.lightRagWorkDir;

    if (!workDir || !command) {
        new Notice("⚠️ Configure LightRAG paths in settings.");
        return;
    }

    await this.updateEnvFile();

    // --- NUEVA VERIFICACIÓN SILENCIOSA ---
    const isAlive = await this.isPortInUse(9621);
    
    if (isAlive) {
        console.log("✅ LightRAG Server ya estaba activo (Puerto 9621 ocupado).");
        return;
    }
    // ------------------------------------

    console.log(`🚀 Starting LightRAG at: ${workDir}`);
    new Notice("🚀 Starting LightRAG...");

    try {
        this.serverProcess = spawn(command, ['--port', '9621', '--working-dir', workDir,'--workers', '1'], {
            cwd: workDir,
            shell: true,
            env: { ...process.env, PYTHONIOENCODING: 'utf-8', FORCE_COLOR: '1' }
        });

        this.serverProcess.stdout?.on('data', (data) => console.log(`[LightRAG]: ${data}`));
// --- CORA MOD: MONITOR DE SIGNOS VITALES (LOGS) ---
        this.serverProcess.stderr?.on('data', (data) => {
            const message = data.toString();
            
            // 1. DETECTOR DE ERRORES CRÍTICOS PARA EL USUARIO
            // Usamos un debounce simple (solo avisar si no hemos avisado en los últimos 5s)
            // para no spammear al usuario si el log sale muchas veces.
            const now = Date.now();
            if (!this.lastErrorTime || (now - this.lastErrorTime > 5000)) {
                
                if (message.includes("Invalid API key") || message.includes("401")) {
                    new Notice("⚠️ Rerank Error: Invalid API Key.\nCheck your settings.", 0);
                    this.lastErrorTime = now;
                }
                
                else if (message.includes("Quota") || message.includes("429")) {
                    new Notice("⚠️ Rerank Error: Out of Credits / Quota Exceeded.", 0);
                    this.lastErrorTime = now;
                }
                
                else if (message.includes("Connection refused") || message.includes("WinError 10061")) {
                    // Este a veces es ruido al cerrar, lo ignoramos o mostramos suave
                }
            }

            // 2. LOGGING A LA CONSOLA (CON FILTRO DE COLOR)
            if (message.includes('INFO:') || message.includes('WARNING:')) {
                console.log(`[LightRAG Log]: ${message}`);
            } else {
                console.error(`[LightRAG Error]: ${message}`);
            }
        });
        // --------------------------------------------
        
        this.serverProcess.on('close', (code) => {
            console.log(`[LightRAG] Finished (Code ${code})`);
            this.serverProcess = null;
        });

        setTimeout(() => {
            if (this.serverProcess) new Notice("✅  LightRAG Activated");
        }, 5000);
    } catch (error) {
        console.error("❌ Error starting server:", error);
        new Notice("❌ Fatal error starting server.");
    }
  }

  async loadSettings() {
    this.settings = parseNeuralComposerSettings(await this.loadData())
    await this.saveData(this.settings)
  }

  async setSettings(newSettings: NeuralComposerSettings) {
    const validationResult = NeuralComposerSettingsSchema.safeParse(newSettings)
    if (!validationResult.success) {
      new Notice('Invalid settings')
      return
    }
    this.settings = newSettings
    await this.saveData(newSettings)
    this.ragEngine?.setSettings(newSettings)
    this.settingsChangeListeners.forEach((listener) => listener(newSettings))
  }

  addSettingsChangeListener(listener: (newSettings: NeuralComposerSettings) => void) {
    this.settingsChangeListeners.push(listener)
    return () => {
      this.settingsChangeListeners = this.settingsChangeListeners.filter((l) => l !== listener)
    }
  }

  async openChatView(openNewChat = false) {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView)
    const editor = view?.editor
    if (!view || !editor) {
      this.activateChatView(undefined, openNewChat)
      return
    }
    const selectedBlockData = await getMentionableBlockData(editor, view)
    this.activateChatView({ selectedBlock: selectedBlockData ?? undefined }, openNewChat)
  }

  async activateChatView(chatProps?: ChatProps, openNewChat = false) {
    this.initialChatProps = chatProps
    const leaf = this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE)[0]
    await (leaf ?? this.app.workspace.getRightLeaf(false))?.setViewState({
      type: CHAT_VIEW_TYPE,
      active: true,
    })
    if (openNewChat && leaf && leaf.view instanceof ChatView) {
      leaf.view.openNewChat(chatProps?.selectedBlock)
    }
    this.app.workspace.revealLeaf(this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE)[0])
  }

  async addSelectionToChat(editor: Editor, view: MarkdownView) {
    const data = await getMentionableBlockData(editor, view)
    if (!data) return
    const leaves = this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE)
    if (leaves.length === 0 || !(leaves[0].view instanceof ChatView)) {
      await this.activateChatView({ selectedBlock: data })
      return
    }
    await this.app.workspace.revealLeaf(leaves[0])
    const chatView = leaves[0].view
    chatView.addSelectionToChat(data)
    chatView.focusMessage()
  }

  // --- BYPASS ---
  async getDbManager(): Promise<DatabaseManager> { return {} as any; }

  async getRAGEngine(): Promise<RAGEngine> {
    if (this.ragEngine) return this.ragEngine
    if (!this.ragEngineInitPromise) {
      this.ragEngineInitPromise = (async () => {
        try {
          this.ragEngine = new RAGEngine(
            this.app, this.settings, {} as any,
            async () => { await this.restartLightRagServer(); }
          )
          return this.ragEngine
        } catch (error) {
          this.ragEngineInitPromise = null
          throw error
        }
      })()
    }
    return this.ragEngineInitPromise
  }

  async getMcpManager(): Promise<McpManager> {
    if (this.mcpManager) return this.mcpManager
    try {
      this.mcpManager = new McpManager({
        settings: this.settings,
        registerSettingsListener: (l) => this.addSettingsChangeListener(l),
      })
      await this.mcpManager.initialize()
      return this.mcpManager
    } catch (error) {
      this.mcpManager = null
      throw error
    }
  }

  private registerTimeout(callback: () => void, timeout: number): void {
    const timeoutId = setTimeout(callback, timeout)
    this.timeoutIds.push(timeoutId)
  }

// --- CORA MOD: ONTÓLOGO AUTOMÁTICO ---
  
  // Función auxiliar para obtener archivos de muestra
  private getRandomNotes(count: number): string {
    const allFiles = this.app.vault.getMarkdownFiles();
    // Barajar y tomar 'count'
    const shuffled = allFiles.sort(() => 0.5 - Math.random());
    const selected = shuffled.slice(0, count);
    
    let contentSample = "";
    selected.forEach(f => {
        // Leemos solo los primeros 500 caracteres de cada nota para no saturar contexto
        // (Esto es síncrono en caché de Obsidian metadata, o asíncrono si leemos full)
        // Para simplificar, usaremos el cache si es posible, o lectura rápida.
        // Haremos lectura real asíncrona:
    });
    return "MUESTRA PENDIENTE"; // Ver implementación abajo completa
  }

  
// Cambiamos la firma para que prometa devolver un string o null
public async generateEntityTypes(): Promise<string | null> {
    const sourcePath = this.settings.lightRagOntologyFolder;
    
    if (!sourcePath) {
        new Notice("⚠️ Please define an 'Ontology Source Folder' first.");
        return null;
    }

    const folder = this.app.vault.getAbstractFileByPath(sourcePath);
    if (!folder || !(folder instanceof TFolder)) {
        new Notice(`❌ Folder not found: "${sourcePath}"`);
        return null;
    }

    new Notice(`🧠 Analyzing notes in "${sourcePath}"...`);

    try {
        const allFiles = this.getAllSupportedFiles(folder);
        if (allFiles.length === 0) throw new Error("Folder is empty.");
        
        const sampleSize = Math.min(allFiles.length, 5);
        const sampleFiles = allFiles.sort(() => 0.5 - Math.random()).slice(0, sampleSize);
        
        let sampleText = "";
        for (const file of sampleFiles) {
            const content = await this.app.vault.read(file);
            sampleText += `--- NOTE: ${file.basename} ---\n${content.substring(0, 1000)}\n...\n\n`;
        }

        const targetLang = this.settings.lightRagSummaryLanguage || 'English';

        const prompt = `
        ACT AS: Senior Data Ontologist & Knowledge Graph Architect.
        TASK: Analyze the provided user's "${sourcePath}" folder to extract the fundamental ontology.
        GOAL: Define a concise list of high-level "Entity Types" that cover the majority of the concepts in the text without being overly granular.
        
        GUIDELINES FOR ENTITY TYPES:
        - **Abstraction:** Prefer broad categories (e.g., use "Organization" instead of "Company", "Startup", "NGO").
        - **Relevance:** Include types for abstract concepts (e.g., "Concept", "Methodology", "Goal") as LightRAG relies on conceptual connections.
        - **Coverage:** The list should allow classifying at least 90% of the key nouns in the text.
        
        RULES:
        1. Output ONLY a comma-separated list of types. NO preamble, NO markdown, NO explanations.
        2. Types must be singular and PascalCase (e.g., ResearchPaper, SoftwareTool).
        3. Limit the list to the top 8-15 most relevant types.
        4. CRITICAL: The output types MUST be in ${targetLang}.

        SAMPLE CONTENT:
        ${sampleText}

        YOUR OUTPUT:
        `;

        const generatedTypes = await this.simpleLLMCall(prompt);
        
        if (generatedTypes) {
            const cleanTypes = generatedTypes.replace(/Here are...|Output:|\[|\]/gi, '').trim();
            
            // Guardamos en settings
            await this.setSettings({
                ...this.settings,
                lightRagEntityTypes: cleanTypes
            });
            
            new Notice("✅ Ontology Generated!");
            await this.updateEnvFile();
            
            // --- CORA MOD: DEVOLVEMOS EL VALOR PARA LA UI ---
            return cleanTypes; 
        }

    } catch (e) {
        console.error(e);
        new Notice("❌ Error generating ontology.");
    }
    return null;
  }

  // Pequeño ayudante para llamar al LLM sin toda la maquinaria del ChatView
  async simpleLLMCall(prompt: string): Promise<string> {
      // Identificar proveedor actual
      const chatModelId = this.settings.chatModelId;
      const modelObj = this.settings.chatModels.find(m => m.id === chatModelId);
      const provider = this.settings.providers.find(p => p.id === modelObj?.providerId);
      
      if (!provider || !modelObj) throw new Error("Modelo no configurado");

      // Lógica simple para Gemini y OpenAI (Ollama similar)
      if (provider.id === 'gemini') {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelObj.model}:generateContent?key=${provider.apiKey}`;
          const response = await fetch(url, {
              method: 'POST',
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
          });
          const data = await response.json();
          return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
      } 
      
      // Fallback genérico para OpenAI/Ollama/Compatible
      const baseUrl = provider.baseUrl || (provider.id === 'openai' ? 'https://api.openai.com/v1' : 'http://localhost:11434/v1');
      const response = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${provider.apiKey || 'ollama'}`
          },
          body: JSON.stringify({
              model: modelObj.model,
              messages: [{ role: 'user', content: prompt }],
              temperature: 0.1
          })
      });
      const data = await response.json();
      return data.choices?.[0]?.message?.content || "";
  }

}