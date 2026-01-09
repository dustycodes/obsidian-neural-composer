# 🧠 Neural Composer
**Deep, graph-based search for your Obsidian Vault.**

![Hero Banner](https://raw.githubusercontent.com/oscampo/obsidian-neural-composer/main/images/hero-banner.png)

## 👋 Hello, Obsidian Community!

We built **Neural Composer** because we love Obsidian, but we often felt limited by standard search tools. 

Have you ever searched for a topic in your vault and gotten a list of notes that contain the *word*, but miss the *context*? Or tried to ask an AI plugin a complex question, only for it to fail because it couldn't "see" the connections between your files?

**We wanted a way to talk to our notes that felt like talking to someone who actually remembers them.**

That's why we integrated **LightRAG** (Graph-based Retrieval) into Obsidian. Unlike standard plugins that just look for matching text chunks, Neural Composer builds a **Knowledge Graph** of your ideas, helping you find relationships you might have forgotten.

---

## 🤔 Why use Graph RAG?

Standard AI search (Vector RAG) is great for finding *similar text*. But **Graph RAG** is better for finding *connected ideas*.

| Feature | Standard Vector Search | Neural Composer (Graph) |
| :--- | :--- | :--- |
| **How it searches** | Finds matching keywords/concepts | Follows relationships between entities |
| **Best for** | Simple questions ("What is X?") | Complex questions ("How does X influence Y?") |
| **Context** | Often fragmented | Holistic and interconnected |

---

## 🛠️ How it helps (Use Cases)

We designed this to fit into different workflows. Here is how it might help you:

*   **For Researchers:** If you have hundreds of papers, you can ask it to synthesize arguments across multiple authors, finding consensus or contradictions that a simple search would miss.
*   **For Writers & DMs:** If you are building a world or a story, the graph tracks the relationships between characters and lore, helping you maintain consistency without digging through folders.
*   **For Daily Journalers:** It connects entries from months ago to today, helping you spot patterns in your life or work that aren't obvious day-to-day.
*   **For Project Managers:** It helps visualize dependencies between different project notes that might otherwise look like separate tasks.

---

## ✨ Features

We wanted the experience to be as smooth as possible:

*   **⚡ Automated Server:** No need to fiddle with terminals. The plugin handles the background Python server for you (starts and stops automatically).
*   **🕸️ Hybrid Search:** You don't have to choose. It combines Vector search with Graph traversal for the best results.
*   **📥 Easy Ingestion:** Right-click any folder to add your notes to the graph. It supports PDFs, DOCX, and more...  <details> <summary> Complete list of supported formats </summary> md, txt, docx, pdf, pptx, xlsx, rtf, odt, epub, html, htm, xml, json, yaml, yml, csv, tex, log, conf, ini, properties, sql, bat, sh, c, cpp, py, java, js, ts, swift, go, rb, php, css, scss, less  </details>
*   **🔍 Transparency:** The chat shows you exactly which files and text segments were used to generate the answer (with citations like `[1]`), so you can always verify the source.
*   **🔒 Local & Private:** You can use local models (like Ollama) for a completely offline experience, or connect to Gemini/OpenAI if you prefer.

---

## 🚀 Getting Started

This plugin requires a small backend setup (Python) to run the LightRAG engine.

### 1. One-time Setup
1.  Ensure you have **Python 3.10+** installed.
2.  Install the engine via terminal:
    ```bash
    pip install "lightrag-hku[api]"
    ```
    *(We recommend using a virtual environment).*

### 2. Install the Plugin
Download `main.js`, `manifest.json`, and `styles.css` from the **[Releases](../../releases)** page and place them in your `.obsidian/plugins/obsidian-neural-composer` folder. Enable it in Obsidian.

### 3. Connect & Go
Go to **Settings > Neural Composer**.
1.  Enter your API Keys (Gemini/OpenAI/Ollama).
2.  In the **Neural Backend** section, paste the path to your `lightrag-server` executable and choose a folder for your data.
3.  Turn on **Auto-start** and click **"Restart Server"**.

You are ready! You can now right-click a folder to ingest your notes and start chatting with your vault.

---

## 🧩 Advanced Options

For those who like to tinker, we added some power features:
*   **Custom Ontology:** Teach the graph the specific categories of your field (e.g., "Experiment", "Theorem") instead of generic ones.
*   **Reranking:** Connect to Jina AI or a local reranker for higher precision results.

---

## 🤝 Acknowledgements

This project is a labor of love, built upon the shoulders of giants:
*   Forked from the excellent **[Smart Composer](https://github.com/glowingjade/obsidian-smart-composer)** by glowingjade.
*   Powered by the **[LightRAG](https://github.com/HKUDS/LightRAG)** library.
*   Developed by **Oscar Campo** & **Cora** (AI).

We hope this helps you connect the dots in your own second brain. Happy composing!
