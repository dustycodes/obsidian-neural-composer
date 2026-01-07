# 🧠 Neural Composer

**Neural Composer** is the graph-based evolution of the *Smart Composer* plugin for Obsidian. 

It upgrades your note-taking experience by connecting Obsidian to a local **LightRAG (Graph RAG)** server. Instead of simple vector search, Neural Composer retrieves information based on **relationships**, deep context, and semantic understanding from your personal knowledge graph.

> **Forked from:** [Smart Composer](https://github.com/glowingjade/obsidian-smart-composer)
> 
> **Developed by:** Oscar Campo & Cora (AI)

## ✨ Features

*   **🕸️ Graph RAG Power:** Queries a local LightRAG server using hybrid search (Vector + Knowledge Graph).
*   **⚡ Automated Lifecycle:** The plugin fully manages the Python server. Auto-starts on load, stops on exit, and restarts with one click.
*   **🧬 Custom Ontology:** Define the "Entity Types" (Categories) that matter to *you*. Includes an **Auto-Detect** feature that analyzes your notes to suggest the perfect ontology structure.
*   **🎯 Semantic Reranking:** Integrated support for **Jina AI**, **Cohere**, or **Custom Local Rerankers** (like BAAI/bge-m3) to drastically improve retrieval precision.
*   **⚙️ Dynamic Configuration:** No need to touch `.env` files. The plugin generates the server configuration automatically based on your settings.
*   **📥 Integrated Ingestion:** 
    *   **Single Note:** Command to ingest the current file.
    *   **Batch Ingestion:** Right-click any folder to ingest all supported files (MD, PDF, DOCX, etc.) recursively.
*   **🔍 Transparent Sources:** 
    *   **Strict Citations:** Option to force academic-style citations `[1]` linked to source files.
    *   **Reference List:** View the exact text segments used to generate the answer.
*   **🎛️ Flexible Query Modes:** Switch between `Mix`, `Hybrid`, `Local`, or `Global` search modes directly from the chat interface.

## 🛠️ Prerequisites

Neural Composer acts as a controller for the **LightRAG Server**. You need the Python environment set up on your machine.

1.  **Install Python (3.10+):** Ensure Python is installed.
2.  **Install LightRAG:**
    ```bash
    pip install "lightrag-hku[api]"
    ```
    *(Recommendation: Use a virtual environment `venv` to keep dependencies clean).*

## 🚀 Installation & Setup

### 1. Install the Plugin
1.  Download `main.js`, `manifest.json`, and `styles.css` from the **[Releases](../../releases)** page.
2.  Create a folder named `obsidian-neural-composer` inside your vault's `.obsidian/plugins/` directory.
3.  Place the files there and **Enable** the plugin in Obsidian Settings.

### 2. Configure the Neural Backend
Go to **Settings > Neural Composer > Neural Backend (LightRAG)**.

1.  **LightRAG Command Path:** Enter the **absolute path** to the `lightrag-server` executable.
    *   *Windows (Virtual Env):* `C:\Users\[YourName]\Projects\my-env\Scripts\lightrag-server.exe`
    *   *Mac/Linux (Virtual Env):* `/home/[User]/projects/my-env/bin/lightrag-server`
2.  **Graph Data Directory:** Enter the absolute path to the folder where you want to store your graph data.
3.  **Graph Logic & Embedding Models:** You can select specific models for the Graph (e.g., use Ollama for indexing but OpenAI for chat).
4.  **Summary Language:** Enter the language of your notes (e.g., "Spanish", "English"). **Crucial for graph quality.**
5.  **Auto-start LightRAG Server:** Toggle this **ON**.
6.  Click **"Restart Server"**.

> **Magic:** The plugin will automatically create/update the `.env` file in your data directory and launch the server for you!

## 🧩 Advanced Configuration

### 🧬 Custom Ontology
Instead of generic "Person/Organization" types, you can teach the graph your specific domain.
1.  Go to **Ontology** settings.
2.  Select a source folder (e.g., "Research").
3.  Click **"✨ Analyze & Generate"**. The AI will suggest types like `Concept`, `Methodology`, `Experiment`.
4.  Enable **"Use Custom Entity Types"** and restart the server.
    *   *⚠️ Warning: Changing ontology requires re-ingesting your data.*

### 🎯 Reranking (Precision Boost)
Filter out irrelevant results before they reach the LLM.
1.  Go to **Reranking** settings.
2.  Select a provider: **Jina AI**, **Cohere**, or **Custom / Local**.
3.  **Local Setup:** If you have a local rerank server (e.g., running `bge-reranker-v2-m3` via API), select "Custom", enter your host URL (e.g., `http://localhost:8182/v1/rerank`), and set Binding Type to `cohere`.

## 💡 Usage

### Building Your Brain (Ingestion)
*   **Single File:** Open a note > Command Palette > **"Neural Composer: Ingest current note"**.
*   **Entire Folder:** File Explorer > Right-Click Folder > **"🧠 Ingest Folder into Graph"**.
    *   *Supports:* MD, TXT, PDF, DOCX, PPTX, and code files.

### Asking Questions (Retrieval)
1.  Open **Neural Composer Chat**.
2.  Select **Vault Chat**.
3.  **Select Mode:**
    *   **Mix/Hybrid:** Best for general questions.
    *   **Global:** Best for "What are the main themes..." summaries.
    *   **Local:** Best for specific details about an entity.
4.  **Citations:** Toggle "Show Citations" in settings if you want strict `[1]` references in the text.

## 🤝 Credits & License

*   **Core UI/UX:** [glowingjade](https://github.com/glowingjade) (Smart Composer).
*   **Graph Integration & Architecture:** Oscar Campo.
*   **Backend Power:** [LightRAG](https://github.com/HKUDS/LightRAG).

MIT License.
