import { ItemView, WorkspaceLeaf, Notice, setIcon, TextComponent, ButtonComponent, setTooltip } from 'obsidian';
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
import { MergeSelectionModal } from '../components/modals/MergeSelectionModal';

export const NATIVE_GRAPH_VIEW_TYPE = 'neural-native-graph';

interface GraphNode {
    id: string;
    type: string;
    desc: string;
    source_id: string;
    val: number; 
    degree?: number;
    file_paths?: string[];
}

export class NativeGraphView extends ItemView {
  private plugin: any; 
  private graphDataPath: string;
  private workDir: string;
  
  private sigmaInstance: Sigma | null = null;
  private fa2Layout: any = null;
  private graph3D: any = null;
  
  private graph: Graph | null = null;
  private chunkToDocMap: Record<string, any> = {};
  private docToNameMap: Record<string, any> = {};

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

    const sidebar = container.createDiv();
    sidebar.style.width = '320px';
    sidebar.style.display = 'flex';
    sidebar.style.flexDirection = 'column';
    sidebar.style.backgroundColor = 'var(--background-secondary)';
    sidebar.style.borderLeft = '1px solid var(--background-modifier-border)';

    this.buildSidebar(sidebar);

    setTimeout(() => this.render(graphContainer), 100);
  }

  async loadReferenceMaps() {
      try {
          const chunksPath = path.join(this.workDir, 'kv_store_text_chunks.json');
          const docsPath = path.join(this.workDir, 'kv_store_doc_status.json');
          if (fs.existsSync(chunksPath)) this.chunkToDocMap = JSON.parse(fs.readFileSync(chunksPath, 'utf-8'));
          if (fs.existsSync(docsPath)) this.docToNameMap = JSON.parse(fs.readFileSync(docsPath, 'utf-8'));
      } catch (e) { console.error("Error loading maps", e); }
  }

  // --- DETECTIVE ESTRICTO (SOLO ARCHIVOS) ---
  getFilenames(sourceIds: string): string[] {
      if (!sourceIds || typeof sourceIds !== 'string') return [];
      
      const chunks = sourceIds.split(new RegExp('<SEP>|,')).map(s => s.trim().replace(/['"\[\]]/g, '')).filter(Boolean);
      const fileNames = new Set<string>();
      
      chunks.forEach(chunkId => {
          const chunkData = this.chunkToDocMap[chunkId];
          
          // 1. Intento directo: ¿Es un nombre de archivo?
          if (chunkId.includes('.') && !chunkId.startsWith('chunk-') && !chunkId.startsWith('doc-')) {
               fileNames.add(chunkId);
               return;
          }

          // 2. Intento vía Mapa
          if (chunkData && chunkData.full_doc_id) {
              const docId = chunkData.full_doc_id;
              const docData = this.docToNameMap[docId];
              
              if (docData) {
                  // Solo aceptamos nombres reales
                  if (docData.file_name) fileNames.add(docData.file_name);
                  else if (docData.source_uri) fileNames.add(docData.source_uri);
                  // ELIMINADO EL FALLBACK A 'content_summary'
              }
          }
      });
      
      // Filtro final: Solo dejar lo que parece un archivo
      return Array.from(fileNames).filter(f => f.includes('.'));
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
        const parser = new XMLParser({ 
            ignoreAttributes: false, 
            attributeNamePrefix: "", 
            textNodeName: "value" 
        });
        const jsonObj = parser.parse(xmlData);
        
        const keys = Array.isArray(jsonObj.graphml?.key) ? jsonObj.graphml.key : [jsonObj.graphml.key];
        const keyMap: Record<string, string> = {};
        keys.forEach((k: any) => { if (k['attr.name']) keyMap[k['id']] = k['attr.name']; });

        const rawNodes = Array.isArray(jsonObj.graphml?.graph?.node) ? jsonObj.graphml.graph.node : [jsonObj.graphml.graph.node];
        const rawEdges = Array.isArray(jsonObj.graphml?.graph?.edge) ? jsonObj.graphml.graph.edge : [jsonObj.graphml.graph.edge];

        const nodeDegrees = new Map<string, number>();
        rawEdges.forEach((e: any) => {
            const src = e.source; const tgt = e.target;
            nodeDegrees.set(src, (nodeDegrees.get(src) || 0) + 1);
            nodeDegrees.set(tgt, (nodeDegrees.get(tgt) || 0) + 1);
        });

        this.allNodes = rawNodes
            .filter((n: any) => {
                if (n.id.startsWith('chunk-') || n.id.startsWith('doc-')) return false;
                if (n.id.length > 50 && !n.id.includes(' ')) return false;
                return true;
            })
            .map((n: any) => {
                let type = "Concept"; let desc = ""; let files: string[] = [];
                const dataArr = Array.isArray(n.data) ? n.data : (n.data ? [n.data] : []);
                
                dataArr.forEach((d: any) => { 
                    const mappedKey = keyMap[d.key] || d.key;
                    if (mappedKey === "entity_type" || d.key === "d0") type = d.value;
                    if (mappedKey === "description" || d.key === "d1") desc = d.value;
                    
                    // EXTRACCIÓN DE FUENTES (CORREGIDA)
                    if (mappedKey === "file_path" || mappedKey === "source_id") {
                        // Llamamos al detective estricto
                        const found = this.getFilenames(String(d.value));
                        files = [...files, ...found];
                    }
                });

                return {
                    id: n.id,
                    type: type,
                    desc: desc,
                    source_id: "", 
                    file_paths: [...new Set(files)], // Deduplicar
                    val: (nodeDegrees.get(n.id) || 0) + 1
                };
            });
        
        const validNodeIds = new Set(this.allNodes.map(n => n.id));
        const validEdges = rawEdges.filter((e: any) => {
            const src = e.source || e['@_source'];
            const tgt = e.target || e['@_target'];
            if (validNodeIds.has(src) && validNodeIds.has(tgt)) {
                e.normalizedSource = src;
                e.normalizedTarget = tgt;
                return true;
            }
            return false;
        });

        this.allNodes.sort((a, b) => b.val - a.val);
        this.filteredNodes = this.allNodes;
        this.updateSidebarList();

        const mode = this.plugin.settings.graphViewMode;
        if(label) label.innerText = `${this.allNodes.length} Nodes | ${validEdges.length} Links | ${mode.toUpperCase()}`;

        if (mode === '3d') {
            this.render3D(container, this.allNodes, validEdges);
        } else {
            this.render2D(container, this.allNodes, validEdges);
        }

    } catch (e) { console.error(e); }
  }

  // --- MOTOR 2D (SIGMA.JS) ---
  render2D(container: HTMLElement, nodes: any[], edges: any[]) {
    this.graph = new Graph();
    const LABEL_THRESHOLD = 4;

    nodes.forEach(n => {
        if (!this.graph?.hasNode(n.id)) {
            const showLabel = n.val > LABEL_THRESHOLD;
            this.graph?.addNode(n.id, {
                label: showLabel ? n.id : '',
                size: Math.max(3, Math.min(n.val * 1.5, 20)),
                color: '#00d4ff', 
                type: 'circle', 
                node_type: n.type, 
                desc: n.desc,
                file_paths: n.file_paths,
                val: n.val,
                forceLabel: showLabel,
                x: Math.random() * 100, 
                y: Math.random() * 100
            });
        }
    });

    edges.forEach(e => {
        const src = e.normalizedSource || e.source;
        const tgt = e.normalizedTarget || e.target;
        if (this.graph?.hasNode(src) && this.graph?.hasNode(tgt)) {
             if (!this.graph.hasEdge(src, tgt)) {
                 this.graph.addEdge(src, tgt, { color: '#333', size: 0.5, hidden: false });
             }
        }
    });

    const initSigma = () => {
        if (container.clientWidth === 0) { requestAnimationFrame(initSigma); return; }
        if (!this.graph) return;
        if (this.sigmaInstance) this.sigmaInstance.kill();

        this.sigmaInstance = new Sigma(this.graph, container, {
            minCameraRatio: 0.001, maxCameraRatio: 10, renderLabels: true,
            labelFont: "monospace", labelColor: { color: "#fff" }, labelSize: 14, labelWeight: "bold",
            allowInvalidContainer: true, zIndex: true
        });

        const settings = forceAtlas2.inferSettings(this.graph);
        this.fa2Layout = new FA2Layout(this.graph, { settings: { ...settings, gravity: 1, slowDown: 5 } });
        this.fa2Layout.start();
        setTimeout(() => { if(this.fa2Layout?.isRunning()) this.fa2Layout.stop(); }, 4000);

        this.sigmaInstance.on("clickNode", (event) => {
            this.focusOnNode2D(event.node);
        });

        this.sigmaInstance.on("enterNode", (event) => {
            const attrs = this.graph?.getNodeAttributes(event.node);
            if (!attrs) return;
            if (attrs.color !== '#ffffff') {
                this.graph?.setNodeAttribute(event.node, 'label', event.node);
                this.graph?.setNodeAttribute(event.node, 'color', '#ff0055');
                this.graph?.setNodeAttribute(event.node, 'zIndex', 10);
            }
        });

        this.sigmaInstance.on("leaveNode", (event) => {
            const attrs = this.graph?.getNodeAttributes(event.node);
            if (!attrs) return;
            if (attrs.color === '#ff0055') {
                this.graph?.setNodeAttribute(event.node, 'color', '#00d4ff');
                this.graph?.setNodeAttribute(event.node, 'zIndex', 0);
                if (attrs.forceLabel) {
                    this.graph?.setNodeAttribute(event.node, 'label', event.node);
                } else {
                    this.graph?.setNodeAttribute(event.node, 'label', '');
                }
            }
        });

        this.sigmaInstance.on("clickStage", () => {
            if (!this.graph) return;
            this.graph.forEachNode((n, a) => {
                this.graph?.setNodeAttribute(n, 'color', '#00d4ff');
                this.graph?.setNodeAttribute(n, 'zIndex', 0);
                this.graph?.setNodeAttribute(n, 'label', a.forceLabel ? n : '');
            });
            this.graph.forEachEdge(e => {
                this.graph?.setEdgeAttribute(e, 'hidden', false);
                this.graph?.setEdgeAttribute(e, 'color', '#333');
            });
            if(this.detailsPanel) this.detailsPanel.style.display = 'none';
        });
    };
    requestAnimationFrame(initSigma);
  }

  // --- MOTOR 3D ---
  render3D(container: HTMLElement, nodes: any[], edges: any[]) {
      const gData = {
          nodes: nodes.map(n => ({ ...n, type: n.type })),
          links: edges.map((e: any) => ({ source: e.normalizedSource || e.source, target: e.normalizedTarget || e.target }))
      };
      this.graph3D = (ForceGraph3D as any)()(container)
          .graphData(gData)
          .backgroundColor('#000005')
          .nodeAutoColorBy('type')
          .nodeVal('val') .nodeRelSize(4) .nodeLabel('id') .nodeOpacity(0.9)
          .linkWidth(0.6).linkOpacity(0.2).cooldownTicks(100)
          .onNodeClick((node: any) => {
              this.showNodeDetails(node);
              const dist = 40;
              const ratio = 1 + dist/Math.hypot(node.x, node.y, node.z);
              this.graph3D.cameraPosition({ x: node.x * ratio, y: node.y * ratio, z: node.z * ratio }, node, 2000);
          });
      this.graph3D.width(container.clientWidth);
      this.graph3D.height(container.clientHeight);
  }

  // --- HELPER 2D ---
  focusOnNode2D(nodeId: string) {
      if (!this.graph || !this.sigmaInstance) return;

      if (this.fa2Layout && this.fa2Layout.isRunning()) {
          this.fa2Layout.stop();
      }

      const attrs = this.graph.getNodeAttributes(nodeId);
      const visualData = this.sigmaInstance.getNodeDisplayData(nodeId);
      if (!visualData || !attrs) return;

      let targetX = attrs.x;
      let targetY = attrs.y;
      if (visualData && typeof visualData.x === 'number' && !isNaN(visualData.x)) {
          targetX = visualData.x; targetY = visualData.y;
      }

      this.sigmaInstance.getCamera().animate({ x: targetX, y: targetY, ratio: 0.15, angle: 0 }, { duration: 1500, easing: 'cubicInOut' });

      this.graph.forEachNode(n => { this.graph?.setNodeAttribute(n, 'color', '#444'); this.graph?.setNodeAttribute(n, 'label', ''); this.graph?.setNodeAttribute(n, 'zIndex', 0); });
      this.graph.forEachEdge(e => this.graph?.setEdgeAttribute(e, 'hidden', true));

      this.graph.forEachNeighbor(nodeId, n => {
          this.graph?.setNodeAttribute(n, 'color', '#ff0055');
          this.graph?.setNodeAttribute(n, 'label', n); 
          this.graph?.setNodeAttribute(n, 'zIndex', 1);
      });
      this.graph.forEachEdge(nodeId, e => {
          this.graph?.setEdgeAttribute(e, 'hidden', false);
          this.graph?.setEdgeAttribute(e, 'color', '#ff0055');
          this.graph?.setEdgeAttribute(e, 'size', 2);
      });

      this.graph.setNodeAttribute(nodeId, 'color', '#ffffff');
      this.graph.setNodeAttribute(nodeId, 'label', nodeId);
      this.graph.setNodeAttribute(nodeId, 'size', (visualData.size || attrs.size || 5) * 1.5);

      this.showNodeDetails({ id: nodeId, ...attrs, type: attrs.node_type });
  }

  cleanup() {
      if (this.sigmaInstance) { this.sigmaInstance.kill(); this.sigmaInstance = null; }
      if (this.fa2Layout) { this.fa2Layout.stop(); this.fa2Layout = null; }
      if (this.graph3D) { (this.graph3D as any)._destructor(); this.graph3D = null; }
  }

  updateSidebarList() {
      if (!this.graph && this.allNodes.length === 0) return;
      this.sortAscending = false;
      this.allNodes.sort((a, b) => b.val - a.val);
      this.filteredNodes = this.allNodes;
      this.renderList();
  }

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

  showNodeDetails(node: any) {
    if (!this.detailsPanel) return;
    const files = node.file_paths || [];
    const sourceHtml = files.length > 0 ? files.map((f: string) => `<li style="margin-bottom:4px; color:#66fcf1;">📄 ${f}</li>`).join('') : '<li style="color:#666;">No explicit source</li>';
    const type = node.node_type || node.type || "Unknown";

    this.detailsPanel.innerHTML = `
        <div style="background:var(--interactive-accent); padding:10px 15px; display:flex; justify-content:space-between; align-items:center;">
            <span style="font-weight:bold; color:white; font-size:0.9em;">${type.toUpperCase()}</span>
            <div style="display:flex; gap:10px;">
                <button id="toggle-edit-btn" style="background:rgba(0,0,0,0.2); border:none; color:white; cursor:pointer; padding:2px 8px; border-radius:4px;" title="Edit Node">✏️ Edit</button>
                <button id="close-panel-btn" style="background:none; border:none; color:white; cursor:pointer; font-weight:bold;">✕</button>
            </div>
        </div>
        <div id="view-mode" style="padding:15px;">
            <h2 style="margin:0 0 15px 0; color:#fff; word-break:break-word;">${node.id}</h2>
            <div style="margin-bottom:15px; color:#aaa; font-size:0.9em;">Degree: <b style="color:#fff">${node.val}</b></div>
            <div style="font-size:0.9em; line-height:1.6; color:#ccc; background:rgba(255,255,255,0.05); padding:10px; border-radius:6px; margin-bottom:15px; max-height:150px; overflow-y:auto;">${node.desc || "No description."}</div>
            <div style="border-top:1px solid #333; padding-top:15px;">
                <h4 style="margin:0 0 10px 0; color:#666; font-size:0.75em; text-transform:uppercase;">Context Sources</h4>
                <ul style="list-style:none; padding-left:0; margin:0;">${sourceHtml}</ul>
            </div>
        </div>
        <div id="edit-mode" style="padding:15px; display:none;">
            <input type="text" id="edit-name" value="${node.id}" style="width:100%; margin-bottom:10px; background:#333; color:white; border:1px solid #555;">
            <input type="text" id="edit-type" value="${type}" style="width:100%; margin-bottom:10px; background:#333; color:white; border:1px solid #555;">
            <textarea id="edit-desc" rows="5" style="width:100%; margin-bottom:10px; background:#333; color:white; border:1px solid #555;">${node.desc || ""}</textarea>
            <button id="save-edit-btn" style="background:var(--interactive-accent); color:white; border:none; width:100%;">💾 Save</button>
            <button id="cancel-edit-btn" style="width:100%; margin-top:5px;">Cancel</button>
        </div>
    `;
    
    const viewDiv = this.detailsPanel.querySelector('#view-mode') as HTMLElement;
    const editDiv = this.detailsPanel.querySelector('#edit-mode') as HTMLElement;
    this.detailsPanel.querySelector('#close-panel-btn')?.addEventListener('click', () => { if(this.detailsPanel) this.detailsPanel.style.display='none'; });
    this.detailsPanel.querySelector('#toggle-edit-btn')?.addEventListener('click', () => { viewDiv.style.display='none'; editDiv.style.display='block'; });
    this.detailsPanel.querySelector('#cancel-edit-btn')?.addEventListener('click', () => { editDiv.style.display='none'; viewDiv.style.display='block'; });
    
    this.detailsPanel.querySelector('#save-edit-btn')?.addEventListener('click', async () => {
        const newName = (this.detailsPanel!.querySelector('#edit-name') as HTMLInputElement).value.trim();
        const newType = (this.detailsPanel!.querySelector('#edit-type') as HTMLInputElement).value.trim();
        const newDesc = (this.detailsPanel!.querySelector('#edit-desc') as HTMLTextAreaElement).value.trim();
        await this.updateNode(node.id, { entity_name: newName, entity_type: newType, description: newDesc });
        if(this.detailsPanel) this.detailsPanel.style.display = 'none';
    });
    this.detailsPanel.style.display = 'block';
  }
  
  async updateNode(oldName: string, data: any) {
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
          if (this.sigmaInstance) this.sigmaInstance.getCamera().animate({ x: 0.5, y: 0.5, ratio: 0.1}, {duration: 500 }); 
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
          const degree = node.val > 0 ? node.val - 1 : 0;
          info.innerHTML = `<div style="font-weight:bold;">${node.id}</div><div style="color:var(--text-muted); font-size:0.9em;">${node.type} (${degree})</div>`;
          info.onclick = () => this.searchNode(node.id); 
      });
      if (this.filteredNodes.length > 100) {
          const more = this.sidebarListEl.createDiv();
          more.style.padding = '10px'; more.style.textAlign = 'center'; more.style.color = 'var(--text-muted)'; more.innerText = `...and ${this.filteredNodes.length - 100} more.`;
      }
  }
  async mergeSelectedNodes() {
      const targets = Array.from(this.selectedNodes);
      if (targets.length < 2) { new Notice("Select 2+ nodes"); return; }
      new MergeSelectionModal(this.plugin.app, targets, async (targetNode: string, sourceNodes: string[]) => {
          new Notice(`Merging into ${targetNode}...`);
          try {
              const response = await fetch("http://localhost:9621/graph/entities/merge", {
                  method: "POST", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ "entity_to_change_into": targetNode, "entities_to_change": sourceNodes })
              });
              if (response.ok) { 
                  new Notice("✅ Merged!"); 
                  this.selectedNodes.clear(); 
                  setTimeout(() => this.render(this.contentEl.querySelector('#sigma-container') as HTMLElement), 1000); 
              } else { new Notice(`Error: ${await response.text()}`); }
          } catch (e) { console.error(e); new Notice("API Error"); }
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
              this.focusOnNode2D(target);
              new Notice(`Found: ${target}`);
          } else { new Notice("Node not found"); }
      }
  }
}