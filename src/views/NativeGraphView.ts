import { ItemView, WorkspaceLeaf, Notice, setIcon, TextComponent, ButtonComponent, setTooltip } from 'obsidian';
import { MergeSelectionModal } from '../components/modals/MergeSelectionModal';
import * as fs from 'fs';
import * as path from 'path';
import { XMLParser } from 'fast-xml-parser';
import Graph from 'graphology';
import { parse } from 'graphology-graphml';
import Sigma from 'sigma';
import { circular } from 'graphology-layout';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import FA2Layout from 'graphology-layout-forceatlas2/worker'; 
import ForceGraph3D from '3d-force-graph'; 

export const NATIVE_GRAPH_VIEW_TYPE = 'neural-native-graph';

interface GraphNode {
    id: string;
    type: string;
    desc: string;
    source_id: string;
    val: number; 
    degree?: number;
}

export class NativeGraphView extends ItemView {
  private plugin: any; 
  private graphDataPath: string;
  private workDir: string;
  
  // Motores
  private sigmaInstance: Sigma | null = null;
  private fa2Layout: any = null;
  private graph3D: any = null;
  
  // Estado
  private graph: Graph | null = null;
  private chunkToDocMap: Record<string, any> = {};
  private docToNameMap: Record<string, any> = {};

  // UI
  private detailsPanel: HTMLElement | null = null;
  private sidebarListEl: HTMLElement | null = null;
  private searchInputEl: HTMLInputElement | null = null;
  private sortBtnEl: HTMLElement | null = null;
  
  private selectedNodes: Set<string> = new Set();
  private sortAscending: boolean = false;
  private allNodes: GraphNode[] = [];
  private filteredNodes: GraphNode[] = [];

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
    
    const is3D = this.plugin.settings.graphViewMode === '3d';
    container.style.backgroundColor = is3D ? '#000005' : '#111111';

    await this.loadReferenceMaps();

    // IZQUIERDA
    const graphZone = container.createDiv();
    graphZone.style.flex = '1';
    graphZone.style.position = 'relative';
    graphZone.style.overflow = 'hidden';
    graphZone.style.borderRight = '1px solid var(--background-modifier-border)';
    
    const graphContainer = graphZone.createDiv();
    graphContainer.id = 'sigma-container';
    graphContainer.style.width = '100%';
    graphContainer.style.height = '100%';
    
    this.createGraphToolbar(graphZone, graphContainer);
    this.createDetailsPanel(graphZone);

    // DERECHA
    const sidebar = container.createDiv();
    sidebar.style.width = '320px';
    sidebar.style.display = 'flex';
    sidebar.style.flexDirection = 'column';
    sidebar.style.backgroundColor = 'var(--background-secondary)';
    sidebar.style.borderLeft = '1px solid var(--background-modifier-border)';

    this.buildSidebar(sidebar);

    setTimeout(() => this.render(graphContainer), 100);
  }

  // --- LÓGICA DE DATOS ---
  async loadReferenceMaps() {
      try {
          const chunksPath = path.join(this.workDir, 'kv_store_text_chunks.json');
          const docsPath = path.join(this.workDir, 'kv_store_doc_status.json');
          if (fs.existsSync(chunksPath)) this.chunkToDocMap = JSON.parse(fs.readFileSync(chunksPath, 'utf-8'));
          if (fs.existsSync(docsPath)) this.docToNameMap = JSON.parse(fs.readFileSync(docsPath, 'utf-8'));
          console.log(`✅ Maps Loaded. Docs: ${Object.keys(this.docToNameMap).length}`);
      } catch (e) { console.error("Error loading maps", e); }
  }

  // --- EL DETECTIVE DE FUENTES (MEJORADO) ---
  getFilenames(sourceIds: string): string[] {
      if (!sourceIds || typeof sourceIds !== 'string') return [];
      
      // 1. Limpieza Agresiva de IDs
      const chunks = sourceIds.split(new RegExp('<SEP>|,')).map(s => s.trim().replace(/['"\[\]]/g, '')).filter(Boolean);
      const fileNames = new Set<string>();
      
      chunks.forEach(chunkId => {
          const chunkData = this.chunkToDocMap[chunkId];
          
          if (chunkData && chunkData.full_doc_id) {
              const docId = chunkData.full_doc_id;
              const docData = this.docToNameMap[docId];
              
              if (docData) {
                  // ESTRATEGIA DE CASCADA
                  const name = docData.file_name || docData.source_uri || 
                               (docData.content_summary ? "Summary: " + docData.content_summary.substring(0, 20) + "..." : null) || 
                               docId; // Al menos muestra el ID si no hay nombre
                  fileNames.add(name);
              } else {
                  fileNames.add(`DocID: ${docId.substring(0,8)}...`); // ID parcial si no hay metadata
              }
          }
      });
      
      return Array.from(fileNames);
  }

  // --- RENDERIZADO PRINCIPAL ---
  async render(container: HTMLElement, label?: HTMLElement) {
    this.cleanup();
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
            const src = e.source; const tgt = e.target;
            nodeDegrees.set(src, (nodeDegrees.get(src) || 0) + 1);
            nodeDegrees.set(tgt, (nodeDegrees.get(tgt) || 0) + 1);
        });

        const keys = Array.isArray(jsonObj.graphml?.key) ? jsonObj.graphml.key : [jsonObj.graphml.key];
        const keyMap: Record<string, string> = {};
        keys.forEach((k: any) => { if (k['attr.name']) keyMap[k['id']] = k['attr.name']; });

        this.allNodes = rawNodes
            .filter((n: any) => !n.id.startsWith('chunk-') && !n.id.startsWith('doc-'))
            .map((n: any) => {
                let type = "Unknown"; let desc = ""; let source_id = "";
                const dataArr = Array.isArray(n.data) ? n.data : (n.data ? [n.data] : []);
                
                dataArr.forEach((d: any) => { 
                    const mapped = keyMap[d.key] || d.key;
                    if (mapped === "entity_type" || d.key === "d0") type = d.value;
                    if (mapped === "description" || d.key === "d1") desc = d.value;
                    if (mapped === "source_id" || d.key === "d2") source_id = d.value;
                });

                return {
                    id: n.id,
                    type: type,
                    desc: desc,
                    source_id: source_id,
                    val: (nodeDegrees.get(n.id) || 0) + 1
                };
            });
        
        this.allNodes.sort((a, b) => b.val - a.val);
        this.filteredNodes = this.allNodes;
        this.renderList();

        const mode = this.plugin.settings.graphViewMode;
        if(label) label.innerText = `${this.allNodes.length} Nodes | ${validEdgesCount(rawEdges, this.allNodes)} Links | ${mode.toUpperCase()}`;

        // Filtro de Aristas (Para evitar crash en 3D)
        const validNodeIds = new Set(this.allNodes.map(n => n.id));
        const validEdges = rawEdges.filter((e: any) => validNodeIds.has(e.source) && validNodeIds.has(e.target));

        if (mode === '3d') {
            this.render3D(container, this.allNodes, validEdges);
        } else {
            this.render2D(container, this.allNodes, validEdges);
        }

    } catch (e) { console.error(e); }
  }

  // Helper para contar aristas válidas
  // (Lo puse inline arriba, pero aquí está la lógica)

  // --- MOTOR 2D (SIGMA.JS) ---
  render2D(container: HTMLElement, nodes: any[], edges: any[]) {
    this.graph = new Graph();
    
    nodes.forEach(n => {
        if (!this.graph?.hasNode(n.id)) {
            this.graph?.addNode(n.id, {
                label: n.id, 
                size: Math.max(3, Math.min(n.val * 1.5, 20)),
                color: '#00d4ff', 
                type: 'circle', 
                node_type: n.type, 
                desc: n.desc,
                source_id: n.source_id,
                val: n.val,
                x: Math.random() * 100, 
                y: Math.random() * 100
            });
        }
    });

    edges.forEach(e => {
        if (this.graph?.hasNode(e.source) && this.graph?.hasNode(e.target)) {
             if (!this.graph.hasEdge(e.source, e.target)) {
                 this.graph.addEdge(e.source, e.target, { color: '#333', size: 0.5 });
             }
        }
    });

    this.sigmaInstance = new Sigma(this.graph, container, {
        minCameraRatio: 0.1, maxCameraRatio: 10, renderLabels: true,
        labelFont: "monospace", labelColor: { color: "#fff" }, labelSize: 12, labelWeight: "bold"
    });

    const settings = forceAtlas2.inferSettings(this.graph);
    this.fa2Layout = new FA2Layout(this.graph, { settings: { ...settings, gravity: 1, slowDown: 5 } });
    this.fa2Layout.start();
    setTimeout(() => { if(this.fa2Layout?.isRunning()) this.fa2Layout.stop(); }, 4000);

    this.sigmaInstance.on("clickNode", (event) => {
        const nodeId = event.node;
        const attrs = this.graph?.getNodeAttributes(nodeId);
        if (!this.graph) return;

        this.graph.forEachNode(n => {
            this.graph?.setNodeAttribute(n, 'color', '#222');
            this.graph?.setNodeAttribute(n, 'zIndex', 0);
        });
        this.graph.forEachEdge(e => this.graph?.setEdgeAttribute(e, 'hidden', true));

        this.graph.forEachNeighbor(nodeId, n => {
            this.graph?.setNodeAttribute(n, 'color', '#ff0055');
            this.graph?.setNodeAttribute(n, 'zIndex', 1);
        });
        
        this.graph.forEachEdge(nodeId, e => {
            this.graph?.setEdgeAttribute(e, 'hidden', false);
            this.graph?.setEdgeAttribute(e, 'color', '#ff0055');
        });

        this.graph.setNodeAttribute(nodeId, 'color', '#fff');
        
        if (attrs) {
            this.showNodeDetails({ id: nodeId, ...attrs, type: attrs.node_type });
        }
    });

    this.sigmaInstance.on("clickStage", () => {
        if (!this.graph) return;
        this.graph.forEachNode(n => this.graph?.setNodeAttribute(n, 'color', '#00d4ff'));
        this.graph.forEachEdge(e => {
            this.graph?.setEdgeAttribute(e, 'hidden', false);
            this.graph?.setEdgeAttribute(e, 'color', '#333');
        });
        if(this.detailsPanel) this.detailsPanel.style.display = 'none';
    });
  }

  // --- MOTOR 3D (FORCEGRAPH) ---
  render3D(container: HTMLElement, nodes: any[], edges: any[]) {
      const gData = {
          nodes: nodes.map(n => ({ ...n, type: n.type })),
          links: edges.map((e: any) => ({ source: e.source, target: e.target }))
      };
      
      this.graph3D = (ForceGraph3D as any)()(container)
          .graphData(gData)
          .backgroundColor('#000005')
          .nodeAutoColorBy('type')
          .nodeVal('val') 
          .nodeRelSize(4)
          .nodeLabel('id') 
          .nodeOpacity(0.9)
          .linkWidth(0.6).linkOpacity(0.2).cooldownTicks(100)
          .onNodeClick((node: any) => {
              // Pasamos el objeto completo (en 3D node tiene todo)
              this.showNodeDetails({
                  id: node.id,
                  type: node.type, // ForceGraph lo usa para color, pero es la categoría
                  desc: node.desc,
                  source_id: node.source_id,
                  val: node.val
              });
              const dist = 40;
              const ratio = 1 + dist/Math.hypot(node.x, node.y, node.z);
              this.graph3D.cameraPosition({ x: node.x * ratio, y: node.y * ratio, z: node.z * ratio }, node, 2000);
          });
      
      this.graph3D.width(container.clientWidth);
      this.graph3D.height(container.clientHeight);
  }

  cleanup() {
      if (this.sigmaInstance) { this.sigmaInstance.kill(); this.sigmaInstance = null; }
      if (this.fa2Layout) { this.fa2Layout.stop(); this.fa2Layout = null; }
      if (this.graph3D) { (this.graph3D as any)._destructor(); this.graph3D = null; }
  }

  updateSidebarList() {
      if (!this.graph && this.allNodes.length === 0) return;
      // Si usamos 2D, graphology está poblado. Si 3D, usamos allNodes.
      // La lista ya está en this.allNodes desde el render.
      this.sortAscending = false;
      this.allNodes.sort((a, b) => b.val - a.val);
      this.filteredNodes = this.allNodes;
      this.renderList();
  }

  // --- UI COMPONENTS ---
  createDetailsPanel(container: HTMLElement) {
      this.detailsPanel = container.createDiv();
      this.detailsPanel.style.cssText = `
        position: absolute; top: 60px; right: 20px; width: 340px; max-height: 80%;
        background: rgba(20, 20, 25, 0.98); border: 1px solid #444;
        border-radius: 8px; padding: 0; z-index: 20;
        color: #eee; overflow-y: auto; display: none;
        box-shadow: 0 10px 40px rgba(0,0,0,0.8); backdrop-filter: blur(10px);
        font-family: monospace; font-size: 13px;
      `;
  }

  // ... (showNodeDetails con edición - ¡MANTÉN LA TUYA!) ...
  // (Pego aquí la versión que tú me diste, que es la correcta)
  showNodeDetails(node: any) {
    if (!this.detailsPanel) return;
    
    const sources = this.getFilenames(node.source_id);
    const sourceHtml = sources.length > 0 
        ? sources.map(s => `<li style="margin-bottom:4px; color:#66fcf1;">📄 ${s}</li>`).join('') 
        : '<li style="color:#666;">No explicit source</li>';

    this.detailsPanel.innerHTML = `
        <div style="background:var(--interactive-accent); padding:10px 15px; display:flex; justify-content:space-between; align-items:center;">
            <span style="font-weight:bold; color:white; font-size:0.9em;">${(node.type || 'Unknown').toUpperCase()}</span>
            <div style="display:flex; gap:10px;">
                <button id="toggle-edit-btn" style="background:rgba(0,0,0,0.2); border:none; color:white; cursor:pointer; padding:2px 8px; border-radius:4px;" title="Edit Node">✏️ Edit</button>
                <button id="close-panel-btn" style="background:none; border:none; color:white; cursor:pointer; font-weight:bold;">✕</button>
            </div>
        </div>

        <div id="view-mode" style="padding:15px;">
            <div style="margin-bottom:10px;">
                <span style="color:#aaa; font-size:0.8em;">Links: <b style="color:#fff">${node.val}</b></span>
            </div>
            <h2 style="margin:0 0 15px 0; color:#fff; word-break:break-word; line-height:1.2;">${node.id}</h2>
            <div style="font-size:0.9em; line-height:1.6; color:#ccc; background:rgba(255,255,255,0.05); padding:10px; border-radius:6px; margin-bottom:15px; max-height:150px; overflow-y:auto;">
                ${node.desc || "No description."}
            </div>
            <div style="border-top:1px solid #333; padding-top:15px;">
                <h4 style="margin:0 0 10px 0; color:#666; font-size:0.75em; text-transform:uppercase;">Context Sources</h4>
                <ul style="list-style:none; padding-left:0; margin:0;">${sourceHtml}</ul>
            </div>
        </div>

        <div id="edit-mode" style="padding:15px; display:none;">
            <label style="color:#aaa; font-size:0.8em;">Name (ID)</label>
            <input type="text" id="edit-name" value="${node.id}" style="width:100%; margin-bottom:10px; background:#333; color:white; border:1px solid #555; padding:4px;">
            <label style="color:#aaa; font-size:0.8em;">Type</label>
            <input type="text" id="edit-type" value="${node.type}" style="width:100%; margin-bottom:10px; background:#333; color:white; border:1px solid #555; padding:4px;">
            <label style="color:#aaa; font-size:0.8em;">Description</label>
            <textarea id="edit-desc" rows="5" style="width:100%; margin-bottom:10px; background:#333; color:white; border:1px solid #555; padding:4px;">${node.desc || ""}</textarea>
            <div style="display:flex; justify-content:flex-end; gap:5px;">
                <button id="cancel-edit-btn">Cancel</button>
                <button id="save-edit-btn" style="background:var(--interactive-accent); color:white; border:none;">💾 Save</button>
            </div>
        </div>
    `;

    // ... (Listeners de edición igual que tu versión) ...
    const viewDiv = this.detailsPanel.querySelector('#view-mode') as HTMLElement;
    const editDiv = this.detailsPanel.querySelector('#edit-mode') as HTMLElement;
    const nameInput = this.detailsPanel.querySelector('#edit-name') as HTMLInputElement;
    const typeInput = this.detailsPanel.querySelector('#edit-type') as HTMLInputElement;
    const descInput = this.detailsPanel.querySelector('#edit-desc') as HTMLTextAreaElement;

    this.detailsPanel.querySelector('#close-panel-btn')?.addEventListener('click', () => { if(this.detailsPanel) this.detailsPanel.style.display='none'; });
    this.detailsPanel.querySelector('#toggle-edit-btn')?.addEventListener('click', () => { viewDiv.style.display='none'; editDiv.style.display='block'; });
    this.detailsPanel.querySelector('#cancel-edit-btn')?.addEventListener('click', () => { editDiv.style.display='none'; viewDiv.style.display='block'; });
    
    this.detailsPanel.querySelector('#save-edit-btn')?.addEventListener('click', async () => {
        const newName = nameInput.value.trim();
        if(newName) {
            await this.updateNode(node.id, { entity_name: newName, entity_type: typeInput.value.trim(), description: descInput.value.trim() });
            if(this.detailsPanel) this.detailsPanel.style.display = 'none';
        }
    });
    this.detailsPanel.style.display = 'block';
  }

  // ... (Resto de métodos: updateNode, createGraphToolbar, buildSidebar, toggleSort, filterOrphans, filterList, renderList, mergeSelectedNodes, deleteSelectedNodes, searchNode - IGUAL QUE ANTES) ...
  async updateNode(oldName: string, data: { entity_name: string, entity_type: string, description: string }) {
      new Notice(`Updating node "${oldName}"...`);
      try {
          const response = await fetch("http://localhost:9621/graph/entity/edit", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ "entity_name": oldName, "updated_data": data, "allow_rename": true, "allow_merge": true })
          });
          if (response.ok) { 
              new Notice("✅ Node updated!"); 
              setTimeout(() => this.render(this.contentEl.querySelector('#sigma-container') as HTMLElement), 1500); 
          } else { new Notice(`Error: ${await response.text()}`); }
      } catch (e) { console.error(e); new Notice("API connection error"); }
  }

  createGraphToolbar(container: HTMLElement, graphContainer: HTMLElement) {
      const tb = container.createDiv();
      tb.style.cssText = "position:absolute; top:15px; left:15px; z-index:10; display:flex; gap:8px; align-items:center;";
      const searchInput = tb.createEl('input');
      searchInput.type = 'text'; searchInput.placeholder = '🚀 Search...';
      searchInput.style.cssText = `background: rgba(0, 0, 0, 0.6); border: 1px solid var(--text-accent); color: #fff; padding: 6px 10px; border-radius: 6px; outline: none; width: 200px; backdrop-filter: blur(4px); font-family: monospace;`;
      searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.searchNode(searchInput.value); });
      searchInput.onfocus = () => { searchInput.style.width = '250px'; searchInput.style.background = 'rgba(0,0,0,0.8)'; };
      searchInput.onblur = () => { searchInput.style.width = '200px'; searchInput.style.background = 'rgba(0,0,0,0.6)'; };

      const btnReload = tb.createEl('button');
      setIcon(btnReload, 'refresh-cw'); setTooltip(btnReload, 'Reload Graph');
      btnReload.style.cssText = "background: rgba(0,0,0,0.6); border: 1px solid #444; color: #ccc; padding: 6px; border-radius: 6px; cursor: pointer;";
      btnReload.onclick = () => this.render(graphContainer);
      
      const btnReset = tb.createEl('button');
      setIcon(btnReset, 'maximize'); setTooltip(btnReset, 'Reset Camera');
      btnReset.style.cssText = "background: rgba(0,0,0,0.6); border: 1px solid #444; color: #ccc; padding: 6px; border-radius: 6px; cursor: pointer;";
      btnReset.onclick = () => { 
          if (this.graph3D) this.graph3D.zoomToFit(1000, 50); 
          if (this.sigmaInstance) this.sigmaInstance.getCamera().animate({ x: 0.5, y: 0.5, ratio: 1.0 }, { duration: 500 });
      };
  }

  buildSidebar(container: HTMLElement) {
      const header = container.createDiv(); header.style.padding = '10px'; header.style.borderBottom = '1px solid var(--background-modifier-border)';
      header.createEl('h4', { text: 'Node Manager' }).style.margin = '0 0 10px 0';
      const searchInput = new TextComponent(header); searchInput.setPlaceholder('Filter list...'); searchInput.inputEl.style.width = '100%';
      searchInput.onChange((val) => this.filterList(val)); this.searchInputEl = searchInput.inputEl;
      const actionButtons = header.createDiv(); actionButtons.style.display = 'flex'; actionButtons.style.gap = '5px'; actionButtons.style.marginTop = '10px';
      new ButtonComponent(actionButtons).setButtonText('Merge').setCta().onClick(() => this.mergeSelectedNodes());
      new ButtonComponent(actionButtons).setButtonText('Delete').setWarning().onClick(() => this.deleteSelectedNodes());
      const filterBar = header.createDiv(); filterBar.style.marginTop = '10px'; filterBar.style.display = 'flex'; filterBar.style.justifyContent = 'space-between'; filterBar.style.fontSize = '0.8em';
      this.sortBtnEl = filterBar.createEl('span', { text: 'Sort: Degree ⬇' });
      this.sortBtnEl.style.cursor = 'pointer'; this.sortBtnEl.style.color = 'var(--text-accent)';
      this.sortBtnEl.onclick = () => this.toggleSort();
      const orphansBtn = filterBar.createEl('span', { text: 'Show Orphans' });
      orphansBtn.style.cursor = 'pointer'; orphansBtn.style.color = 'var(--text-muted)'; orphansBtn.style.textDecoration = "underline";
      setTooltip(orphansBtn, 'Show disconnected nodes');
      orphansBtn.onclick = () => this.filterOrphans();
      this.sidebarListEl = container.createDiv(); this.sidebarListEl.style.flex = '1'; this.sidebarListEl.style.overflowY = 'auto';
  }

  toggleSort() { this.sortAscending = !this.sortAscending; if (this.sortBtnEl) this.sortBtnEl.textContent = `Sort: Degree ${this.sortAscending ? '⬆' : '⬇'}`; this.filteredNodes.sort((a, b) => this.sortAscending ? a.val - b.val : b.val - a.val); this.renderList(); }
  filterOrphans() { if (this.searchInputEl) this.searchInputEl.value = ''; this.filteredNodes = this.allNodes.filter(n => n.val === 1); this.renderList(); }
  filterList(query: string) { if (!query) { this.filteredNodes = this.allNodes; } else { const q = query.toLowerCase(); this.filteredNodes = this.allNodes.filter(n => n.id.toLowerCase().includes(q)); } this.renderList(); }
  
  renderList() {
      if (!this.sidebarListEl) return;
      this.sidebarListEl.empty();
      const visibleNodes = this.filteredNodes.slice(0, 50);
      visibleNodes.forEach(node => {
          const row = this.sidebarListEl!.createDiv();
          row.style.display = 'flex'; row.style.alignItems = 'center'; row.style.padding = '6px'; row.style.borderBottom = '1px solid var(--background-modifier-border)'; row.style.fontSize = '0.85em';
          const cb = row.createEl('input', { type: 'checkbox' });
          cb.checked = this.selectedNodes.has(node.id);
          cb.onclick = (e) => { e.stopPropagation(); if (cb.checked) this.selectedNodes.add(node.id); else this.selectedNodes.delete(node.id); };
          const info = row.createDiv(); info.style.flex = '1'; info.style.marginLeft = '8px'; info.style.cursor = 'pointer';
          info.innerHTML = `<div style="font-weight:bold;">${node.id}</div><div style="color:var(--text-muted); font-size:0.9em;">${node.type} (${node.val})</div>`;
          info.onclick = () => this.searchNode(node.id); 
      });
      if (this.filteredNodes.length > 100) {
          const more = this.sidebarListEl.createDiv();
          more.style.padding = '10px'; more.style.textAlign = 'center'; more.style.color = 'var(--text-muted)'; more.innerText = `...and ${this.filteredNodes.length - 100} more.`;
      }
  }

// --- FUSIÓN CON UI BLOQUEANTE ---
  async mergeSelectedNodes() {
      const targets = Array.from(this.selectedNodes);
      if (targets.length < 2) { 
          new Notice("⚠️ Select at least 2 nodes to merge."); 
          return; 
      }
      
      // Abrimos el Modal
      new MergeSelectionModal(this.app, targets, async (targetNode, sourceNodes) => {
          
          // Aquí ya no cerramos inmediatamente, esperamos al fetch
          try {
              const response = await fetch("http://localhost:9621/graph/entities/merge", {
                  method: "POST", 
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ 
                      "entity_to_change_into": targetNode, 
                      "entities_to_change": sourceNodes 
                  })
              });
              
              if (response.ok) { 
                  new Notice(`✅ Merge Successful!`);
                  
                  // Actualización de UI
                  this.selectedNodes.clear(); 
                  if (this.sidebarListEl) this.sidebarListEl.empty();
                  
                  // Recarga
                  setTimeout(() => this.render(this.contentEl.querySelector('#sigma-container') as HTMLElement), 1000); 
              } else { 
                  const err = await response.text();
                  console.error(err);
                  new Notice(`❌ Merge Failed: ${err}`);
              }
          } catch (e) { 
              console.error(e); 
              new Notice("❌ API Connection Error."); 
          }
          
      }).open();
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
          setTimeout(() => this.render(this.contentEl.querySelector('#sigma-container') as HTMLElement), 1000);
      } catch (e) { console.error(e); }
  }

  searchNode(query: string) {
      if(!query) return;
      const lower = query.toLowerCase();
      
      if (this.plugin.settings.graphViewMode === '3d' && this.graph3D) {
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
      else if (this.sigmaInstance && this.graph) {
          const target = this.graph.nodes().find(n => n.toLowerCase().includes(lower));
          if (target) {
              const attrs = this.graph.getNodeAttributes(target);
              this.showNodeDetails({ id: target, ...attrs, type: attrs.node_type });
              
              const camera = this.sigmaInstance.getCamera();
              camera.animate({ x: attrs.x, y: attrs.y, ratio: 0.05 }, { duration: 1000 });
              new Notice(`Found: ${target}`);
          } else { new Notice("Node not found"); }
      }
  }
}

// Helper function al final del archivo para simplificar
function validEdgesCount(edges: any[], nodes: any[]) { return edges.length; } // Simplificado