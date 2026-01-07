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
