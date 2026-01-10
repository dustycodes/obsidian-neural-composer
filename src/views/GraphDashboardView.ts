import { ItemView, WorkspaceLeaf } from 'obsidian';

export const GRAPH_VIEW_TYPE = 'neural-graph-dashboard';

export class GraphDashboardView extends ItemView {
  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType() {
    return GRAPH_VIEW_TYPE;
  }

  getDisplayText() {
    return 'Neural Graph Dashboard';
  }

  getIcon() {
    return 'brain-circuit';
  }

  async onOpen() {
    const container = this.contentEl;
    container.empty();
    
    // Contenedor principal sin bordes
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.height = '100%';
    container.style.padding = '0';
    container.style.overflow = 'hidden';
    container.style.backgroundColor = 'var(--background-primary)';

    // Barra de herramientas superior
    const header = container.createDiv();
    header.style.padding = '8px 12px';
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.background = 'var(--background-secondary)';
    header.style.borderBottom = '1px solid var(--background-modifier-border)';

    // Título pequeño
    const title = header.createEl('span');
    title.innerText = 'Server Status: Online 🟢';
    title.style.fontSize = '0.8em';
    title.style.color = 'var(--text-muted)';

    // Botón de Recarga (Vital por si se queda en blanco al inicio)
    const refreshBtn = header.createEl('button');
    refreshBtn.textContent = '🔄 Reload Dashboard';
    refreshBtn.style.cursor = 'pointer';
    refreshBtn.onclick = () => this.reloadFrame();

    // El Iframe Estándar (Estable)
    const frame = container.createEl('iframe');
    frame.id = 'lightrag-frame';
    frame.src = 'http://localhost:9621/webui'; // URL Directa
    frame.setAttribute('style', 'width:100%; height:100%; border:none; flex-grow:1;');
    frame.setAttribute('allow', 'clipboard-read; clipboard-write');
  }

  reloadFrame() {
    const frame = this.contentEl.querySelector('#lightrag-frame') as HTMLIFrameElement;
    if (frame) {
        // Forzamos la recarga de la fuente
        // Agregamos un timestamp para evitar caché
        frame.src = `http://localhost:9621/webui?t=${Date.now()}`;
    }
  }

  async onClose() {
    // Limpieza
  }
}