import { ItemView, WorkspaceLeaf, Notice, setIcon, TextComponent, ButtonComponent, setTooltip } from 'obsidian';
import * as fs from 'fs';
import * as path from 'path';
import { XMLParser } from 'fast-xml-parser';
import cytoscape from 'cytoscape';
import ForceGraph3D from '3d-force-graph';

export const NATIVE_GRAPH_VIEW_TYPE = 'neural-native-graph';

interface GraphNode {
    id: string;
    type: string;
    desc: string;
    source_id: string;
    val: number; // 1 (sin conexiones) a N
}

export class NativeGraphView extends ItemView {
  private plugin: any; 
  private graphDataPath: string;
  private workDir: string;
  
  private cy: any = null;
  private graph3D: any = null;
  
  // Datos
  private allNodes: GraphNode[] = [];
  private filteredNodes: GraphNode[] = [];
  private selectedNodes: Set<string> = new Set();

  // Estado de UI
  private sortAscending: boolean = false; // false = Descendente (Mayor a menor)

  // Lookup Maps
  private chunkToDocMap: Record<string, any> = {};
  private docToNameMap: Record<string, any> = {};

  // UI Elements
  private sidebarListEl: HTMLElement | null = null;
  private searchInputEl: TextComponent | null = null; // Guardamos el componente para limpiarlo
  private detailsPanel: HTMLElement | null = null;
  private sortBtnEl: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: any) {
    super(leaf);
    this.plugin = plugin;
    this.workDir = plugin.settings.lightRagWorkDir;
    this.graphDataPath = path.join(this.workDir, 'graph_chunk_entity_relation.graphml');
  }

  getViewType() { return NATIVE_GRAPH_VIEW_TYPE; }
  getDisplayText() { return 'Neural Manager'; }
  getIcon() { return 'brain-circuit'; }

  async onOpen() {
    const container = this.contentEl;
    container.empty();
    container.style.display = 'flex';
    container.style.height = '100%';
    container.style.width = '100%';
    container.style.backgroundColor = 'var(--background-primary)';

    await this.loadReferenceMaps();

    // --- ZONA IZQUIERDA: GRAFO (70%) ---
    const graphZone = container.createDiv();
    graphZone.style.flex = '1';
    graphZone.style.position = 'relative';
    graphZone.style.overflow = 'hidden';
    graphZone.style.borderRight = '1px solid var(--background-modifier-border)';
    
    const graphCanvas = graphZone.createDiv();
    graphCanvas.id = 'graph-container';
    graphCanvas.style.width = '100%';
    graphCanvas.style.height = '100%';
    
    this.createGraphToolbar(graphZone, graphCanvas);
    this.createDetailsPanel(graphZone);

    // --- ZONA DERECHA: GESTOR (30%) ---
    const sidebar = container.createDiv();
    sidebar.style.width = '320px';
    sidebar.style.display = 'flex';
    sidebar.style.flexDirection = 'column';
    sidebar.style.backgroundColor = 'var(--background-secondary)';
    sidebar.style.borderLeft = '1px solid var(--background-modifier-border)';

    this.buildSidebar(sidebar);

    setTimeout(() => this.render(graphCanvas), 100);
  }

  async loadReferenceMaps() {
      try {
          const chunksPath = path.join(this.workDir, 'kv_store_text_chunks.json');
          const docsPath = path.join(this.workDir, 'kv_store_doc_status.json');
          if (fs.existsSync(chunksPath)) this.chunkToDocMap = JSON.parse(fs.readFileSync(chunksPath, 'utf-8'));
          if (fs.existsSync(docsPath)) this.docToNameMap = JSON.parse(fs.readFileSync(docsPath, 'utf-8'));
      } catch (e) { console.error("Error loading maps", e); }
  }

  getFilenames(sourceIds: string): string[] {
      if (!sourceIds) return [];
      const chunks = sourceIds.split(/<SEP>|,/).map(s => s.trim()).filter(Boolean);
      const fileNames = new Set<string>();
      chunks.forEach(chunkId => {
          const chunkData = this.chunkToDocMap[chunkId];
          if (chunkData && chunkData.full_doc_id) {
              const docData = this.docToNameMap[chunkData.full_doc_id];
              if (docData) {
                  fileNames.add(docData.file_name || docData.id || "Unknown");
              }
          }
      });
      return Array.from(fileNames);
  }

  // --- UI COMPONENTS ---

  createDetailsPanel(container: HTMLElement) {
      this.detailsPanel = container.createDiv();
      this.detailsPanel.style.cssText = `
        position: absolute; top: 60px; right: 20px; width: 300px; max-height: 80%;
        background: rgba(20, 20, 25, 0.95); border: 1px solid #444;
        border-radius: 8px; padding: 15px; z-index: 20;
        color: #eee; overflow-y: auto; display: none;
        box-shadow: 0 10px 30px rgba(0,0,0,0.5); backdrop-filter: blur(10px);
        font-family: monospace; font-size: 13px;
      `;
  }

  showNodeDetails(node: any) {
    if (!this.detailsPanel) return;
    
    const sources = this.getFilenames(node.source_id);
    const sourceHtml = sources.length > 0 
        ? sources.map(s => `<li style="margin-bottom:4px; color:#66fcf1;">📄 ${s}</li>`).join('') 
        : '<li style="color:#666;">No explicit source</li>';

    this.detailsPanel.innerHTML = `
        <div style="display:flex; justify-content:space-between; margin-bottom:10px;">
            <span style="background:#ff0055; color:white; padding:2px 8px; border-radius:4px; font-size:0.8em;">${node.type?.toUpperCase()}</span>
            <button style="background:none; border:none; color:#888; cursor:pointer;" id="close-panel-btn">✕</button>
        </div>
        <h3 style="margin:0 0 10px 0; color:#fff; word-break:break-word;">${node.id}</h3>
        
        <div style="margin-bottom:15px; color:#aaa; font-size:0.9em;">
            Connections: <b style="color:#fff">${node.val}</b>
        </div>
        
        <div style="font-size:0.9em; line-height:1.5; color:#ccc; background:rgba(255,255,255,0.05); padding:10px; border-radius:6px; margin-bottom:15px; max-height:150px; overflow-y:auto;">
            ${node.desc || "No description."}
        </div>

        <h4 style="margin:0 0 5px 0; color:#888; font-size:0.8em; text-transform:uppercase;">Context Sources</h4>
        <ul style="list-style:none; padding-left:0; margin:0;">${sourceHtml}</ul>
    `;
    
    this.detailsPanel.querySelector('#close-panel-btn')?.addEventListener('click', () => {
        if (this.detailsPanel) this.detailsPanel.style.display = 'none';
    });

    this.detailsPanel.style.display = 'block';
  }

  createGraphToolbar(container: HTMLElement, graphCanvas: HTMLElement) {
      const tb = container.createDiv();
      tb.style.cssText = "position:absolute; top:15px; left:15px; z-index:10; display:flex; gap:8px; align-items:center;";
      
      const searchInput = tb.createEl('input');
      searchInput.type = 'text';
      searchInput.placeholder = '🚀 Search & Fly...';
      searchInput.style.cssText = `
          background: rgba(0, 0, 0, 0.6); border: 1px solid #45a29e; color: #fff;
          padding: 6px 10px; border-radius: 6px; outline: none; width: 200px;
          backdrop-filter: blur(4px); transition: all 0.2s ease; font-family: monospace;
      `;
      searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.searchNode(searchInput.value); });

      const btnReload = tb.createEl('button');
      setIcon(btnReload, 'refresh-cw');
      setTooltip(btnReload, 'Reload Graph');
      btnReload.style.cssText = "background: rgba(0,0,0,0.6); border: 1px solid #444; color: #ccc; padding: 6px; border-radius: 6px; cursor: pointer;";
      btnReload.onclick = () => this.render(graphCanvas);
      
      const btnReset = tb.createEl('button');
      setIcon(btnReset, 'maximize');
      setTooltip(btnReset, 'Reset Camera');
      btnReset.style.cssText = "background: rgba(0,0,0,0.6); border: 1px solid #444; color: #ccc; padding: 6px; border-radius: 6px; cursor: pointer;";
      btnReset.onclick = () => { if (this.graph3D) this.graph3D.zoomToFit(1000, 50); };
  }

  buildSidebar(container: HTMLElement) {
      const header = container.createDiv();
      header.style.padding = '10px';
      header.style.borderBottom = '1px solid var(--background-modifier-border)';
      
      header.createEl('h4', { text: 'Node Manager' }).style.margin = '0 0 10px 0';

      const searchInput = new TextComponent(header);
      searchInput.setPlaceholder('Filter list...');
      searchInput.inputEl.style.width = '100%';
      searchInput.onChange((val) => this.filterList(val));
      this.searchInputEl = searchInput;

      const actionButtons = header.createDiv();
      actionButtons.style.display = 'flex';
      actionButtons.style.gap = '5px';
      actionButtons.style.marginTop = '10px';

      new ButtonComponent(actionButtons).setButtonText('Merge Selected').setCta().onClick(() => this.mergeSelectedNodes());
      new ButtonComponent(actionButtons).setButtonText('Delete Selected').setWarning().onClick(() => this.deleteSelectedNodes());

      // --- BARRA DE FILTROS ---
      const filterBar = header.createDiv();
      filterBar.style.marginTop = '10px';
      filterBar.style.display = 'flex';
      filterBar.style.justifyContent = 'space-between';
      filterBar.style.fontSize = '0.8em';
      
      // Botón SORT (Con flecha dinámica)
      this.sortBtnEl = filterBar.createEl('span', { text: 'Sort: Degree ⬇' });
      this.sortBtnEl.style.cursor = 'pointer'; 
      this.sortBtnEl.style.color = 'var(--text-accent)';
      this.sortBtnEl.onclick = () => this.toggleSort();

      // Botón ORPHANS
      const orphansBtn = filterBar.createEl('span', { text: 'Show Orphans' });
      orphansBtn.style.cursor = 'pointer'; 
      orphansBtn.style.color = 'var(--text-muted)';
      orphansBtn.style.textDecoration = "underline";
      setTooltip(orphansBtn, 'Show disconnected nodes (0 edges)');
      orphansBtn.onclick = () => this.filterOrphans();

      this.sidebarListEl = container.createDiv();
      this.sidebarListEl.style.flex = '1';
      this.sidebarListEl.style.overflowY = 'auto';
  }

  filterList(query: string) {
      if (!query) { this.filteredNodes = this.allNodes; } 
      else { const q = query.toLowerCase(); this.filteredNodes = this.allNodes.filter(n => n.id.toLowerCase().includes(q)); }
      this.renderList();
  }

  // --- ORDENAMIENTO BIDIRECCIONAL ---
  toggleSort() {
      this.sortAscending = !this.sortAscending;
      if (this.sortBtnEl) this.sortBtnEl.textContent = `Sort: Degree ${this.sortAscending ? '⬆' : '⬇'}`;
      
      this.filteredNodes.sort((a, b) => {
          return this.sortAscending ? a.val - b.val : b.val - a.val;
      });
      this.renderList();
  }

  // --- FILTRO DE HUÉRFANOS ---
  filterOrphans() {
      if (this.searchInputEl) this.searchInputEl.setValue(""); // Limpiar búsqueda
      // En nuestra lógica de visualización: val = connections + 1. 
      // Así que val=1 significa 0 conexiones.
      this.filteredNodes = this.allNodes.filter(n => n.val === 1);
      this.renderList();
      new Notice(`Found ${this.filteredNodes.length} orphan nodes.`);
  }

  renderList() {
      if (!this.sidebarListEl) return;
      this.sidebarListEl.empty();
      
      // Renderizar primeros 100
      const visibleNodes = this.filteredNodes.slice(0, 100);
      
      visibleNodes.forEach(node => {
          const row = this.sidebarListEl!.createDiv();
          row.style.display = 'flex';
          row.style.alignItems = 'center';
          row.style.padding = '6px';
          row.style.borderBottom = '1px solid var(--background-modifier-border)';
          row.style.fontSize = '0.85em';
          
          const cb = row.createEl('input', { type: 'checkbox' });
          cb.checked = this.selectedNodes.has(node.id);
          cb.onclick = (e) => { e.stopPropagation(); if (cb.checked) this.selectedNodes.add(node.id); else this.selectedNodes.delete(node.id); };
          
          const info = row.createDiv();
          info.style.flex = '1';
          info.style.marginLeft = '8px';
          info.style.cursor = 'pointer';
          
          // Mostrar grado real (val - 1)
          const degree = node.val > 0 ? node.val - 1 : 0;
          
          info.innerHTML = `<div style="font-weight:bold;">${node.id}</div><div style="color:var(--text-muted); font-size:0.9em;">${node.type} (Links: ${degree})</div>`;
          
          info.onclick = () => this.searchNode(node.id); 
      });

      if (this.filteredNodes.length > 100) {
          const more = this.sidebarListEl.createDiv();
          more.style.padding = '10px';
          more.style.textAlign = 'center';
          more.style.color = 'var(--text-muted)';
          more.innerText = `...and ${this.filteredNodes.length - 100} more.`;
      }
  }

  // --- API ACTIONS (Merge & Delete) ---
  async mergeSelectedNodes() {
      const targets = Array.from(this.selectedNodes);
      if (targets.length < 2) { new Notice("Select 2+ nodes"); return; }
      if(!confirm(`Merge ${targets.length} nodes into "${targets[0]}"?`)) return;

      try {
          const response = await fetch("http://localhost:9621/graph/entities/merge", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ "entity_to_change_into": targets[0], "entities_to_change": targets.slice(1) })
          });
          if (response.ok) { new Notice("Merged!"); this.selectedNodes.clear(); setTimeout(() => this.render(this.contentEl.querySelector('#graph-container') as HTMLElement), 1000); }
      } catch (e) { console.error(e); }
  }

  async deleteSelectedNodes() {
      const targets = Array.from(this.selectedNodes);
      if (targets.length === 0) return;
      if(!confirm(`Delete ${targets.length} nodes?`)) return;

      try {
          for (const entity of targets) {
              await fetch("http://localhost:9621/documents/delete_entity", {
                  method: "DELETE", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ "entity_name": entity })
              });
          }
          new Notice("Deleted!"); this.selectedNodes.clear();
          setTimeout(() => this.render(this.contentEl.querySelector('#graph-container') as HTMLElement), 1000);
      } catch (e) { console.error(e); }
  }

  // --- RENDERIZADO PRINCIPAL ---
  async render(container: HTMLElement, label?: HTMLElement) {
    if (this.graph3D) { (this.graph3D as any)._destructor(); this.graph3D = null; }
    container.empty();

    if (!fs.existsSync(this.graphDataPath)) {
        if(label) label.innerText = "❌ No Data";
        return;
    }

    try {
        const xmlData = fs.readFileSync(this.graphDataPath, 'utf-8');
        const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "", textNodeName: "value" });
        const jsonObj = parser.parse(xmlData);
        
        const rawNodes = Array.isArray(jsonObj.graphml?.graph?.node) ? jsonObj.graphml.graph.node : [jsonObj.graphml.graph.node];
        const rawEdges = Array.isArray(jsonObj.graphml?.graph?.edge) ? jsonObj.graphml.graph.edge : [jsonObj.graphml.graph.edge];

        const nodeDegrees = new Map<string, number>();
        rawEdges.forEach((e: any) => {
            const src = e.source; 
            const tgt = e.target;
            nodeDegrees.set(src, (nodeDegrees.get(src) || 0) + 1);
            nodeDegrees.set(tgt, (nodeDegrees.get(tgt) || 0) + 1);
        });

        this.allNodes = rawNodes.map((n: any) => {
            let type = "Unknown";
            let desc = "";
            let source_id = "";
            
            const dataArr = Array.isArray(n.data) ? n.data : (n.data ? [n.data] : []);
            
            dataArr.forEach((d: any) => { 
                if (d.key === "d0" || d.key === "entity_type") type = d.value;
                if (d.key === "d1" || d.key === "description") desc = d.value;
                if (d.key === "d2" || d.key === "source_id") source_id = d.value;
            });

            return {
                id: n.id,
                type: type,
                desc: desc,
                source_id: source_id,
                val: (nodeDegrees.get(n.id) || 0) + 1 // +1 para que sea visible si es huérfano (size)
            };
        });
        
        // Ordenar inicial descendente
        this.allNodes.sort((a, b) => b.val - a.val);
        this.filteredNodes = this.allNodes;
        this.renderList();

        this.render3D(container, this.allNodes, rawEdges);

    } catch (e) { console.error(e); }
  }

  render3D(container: HTMLElement, nodes: any[], edges: any[]) {
      const gData = {
          nodes: nodes,
          links: edges.map((e: any) => ({ source: e.source, target: e.target }))
      };
      
      const mode = this.plugin.settings.graphViewMode;
      const bg = mode === '3d' ? '#000005' : '#ffffff';

      this.graph3D = (ForceGraph3D as any)()(container)
          .graphData(gData)
          .backgroundColor(bg)
          .nodeAutoColorBy('type')
          .nodeVal('val') 
          .nodeRelSize(4)
          .nodeLabel((node: any) => `${node.id}`) 
          .nodeOpacity(0.9)
          .nodeResolution(16)
          .linkWidth(0.6)
          .linkOpacity(0.2)
          .cooldownTicks(100)
          .onNodeClick((node: any) => {
              this.showNodeDetails(node);
              const dist = 40;
              const ratio = 1 + dist/Math.hypot(node.x, node.y, node.z);
              this.graph3D.cameraPosition({ x: node.x * ratio, y: node.y * ratio, z: node.z * ratio }, node, 2000);
          });
      
      this.graph3D.width(container.clientWidth);
      this.graph3D.height(container.clientHeight);
  }

  searchNode(query: string) {
      if(!query || !this.graph3D) return;
      const lower = query.toLowerCase();
      const { nodes } = this.graph3D.graphData();
      const target = nodes.find((n: any) => n.id.toLowerCase().includes(lower));
      
      if (target) {
          this.showNodeDetails(target);
          const dist = 40;
          const ratio = 1 + dist/Math.hypot(target.x, target.y, target.z);
          this.graph3D.cameraPosition({ x: target.x * ratio, y: target.y * ratio, z: target.z * ratio }, target, 2000);
          new Notice(`Found: ${target.id}`);
      } else { new Notice("Node not found"); }
  }
}