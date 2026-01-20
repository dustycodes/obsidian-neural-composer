import { ItemView, WorkspaceLeaf, Notice, setIcon, TextComponent, ButtonComponent, setTooltip, requestUrl} from 'obsidian';
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
    
    // Reemplaza: display, height, width, background
    container.addClass('nrlcmp-graph-view'); 
    
    // Manejo de fondo (Dinámico)
    // Asegúrate de tener estas clases en tu CSS o usa una variable CSS
    const is3D = this.plugin.settings.graphViewMode === '3d';
    if (is3D) container.addClass('nrlcmp-bg-3d'); // Define background: #000005 en CSS
    else container.addClass('nrlcmp-bg-2d');      // Define background: #111111 en CSS

    await this.loadReferenceMaps();

    // IZQUIERDA (Zona del Grafo)
    const graphZone = container.createDiv();
    // Reemplaza: flex: 1, relative, overflow, border-right
    graphZone.addClass('nrlcmp-graph-zone');
    
    const graphContainer = graphZone.createDiv();
    graphContainer.id = 'sigma-container';
    // Reemplaza: width: 100%, height: 100%
    graphContainer.addClass('nrlcmp-sigma-container');
    
    this.createGraphToolbar(graphZone, graphContainer);
    this.createDetailsPanel(graphZone);

    // DERECHA (Barra Lateral)
    const sidebar = container.createDiv();
    // Reemplaza: width, flex-col, background, border-left
    sidebar.addClass('nrlcmp-sidebar');

    this.buildSidebar(sidebar);

    setTimeout(() => { void this.render(graphContainer); }, 100);
  }

  // --- LÓGICA DE DATOS ---
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
      const chunks = sourceIds.split(new RegExp('<SEP>|,')).map(s => s.trim().replace(/['"\[\]]/g, '')).filter(Boolean);
      const fileNames = new Set<string>();
      chunks.forEach(chunkId => {
          const chunkData = this.chunkToDocMap[chunkId];
          if (chunkData && chunkData.full_doc_id) {
              const docData = this.docToNameMap[chunkData.full_doc_id];
              if (docData) fileNames.add(docData.file_name || docData.id || "Unknown");
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
                    
                    if (mappedKey === "file_path" || mappedKey === "source_id") {
                         const val = String(d.value);
                         if (val.includes('.md') || val.includes('.pdf') || val.includes('.txt')) {
                             files = val.split('<SEP>').filter(s => s.trim().length > 0);
                         }
                    }
                });

                return {
                    id: n.id,
                    type: type,
                    desc: desc,
                    source_id: "", 
                    file_paths: files, 
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

  // --- HELPER 2D: NAVEGACIÓN PRECISA ---
  focusOnNode2D(nodeId: string) {
      if (!this.graph || !this.sigmaInstance) return;

      if (this.fa2Layout && this.fa2Layout.isRunning()) {
          this.fa2Layout.stop();
      }

      const attrs = this.graph.getNodeAttributes(nodeId);
      const visualData = this.sigmaInstance.getNodeDisplayData(nodeId);
      if (!attrs) return;

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
      this.graph.setNodeAttribute(nodeId, 'size', (visualData?.size || attrs.size || 5) * 1.5);

      this.showNodeDetails({ id: nodeId, ...attrs, type: attrs.node_type });
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

        // --- EVENTOS ---
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

  // --- UI COMPONENTS (SANITIZADOS) ---
  createDetailsPanel(container: HTMLElement) {
      this.detailsPanel = container.createDiv();
      this.detailsPanel.style.cssText = `position: absolute; top: 60px; right: 20px; width: 340px; max-height: 80%; background: rgba(20, 20, 25, 0.98); border: 1px solid #444; border-radius: 8px; padding: 0; z-index: 20; color: #eee; overflow-y: auto; display: none; box-shadow: 0 10px 40px rgba(0,0,0,0.8); backdrop-filter: blur(10px); font-family: monospace; font-size: 13px;`;
  }

  // --- REFACTORIZADO PARA OBSIDIAN REVIEW ---
  showNodeDetails(node: any) {
    if (!this.detailsPanel) return;
    this.detailsPanel.empty();

    const files = node.file_paths || [];
    const type = node.node_type || node.type || "Unknown";
    const desc = node.desc || "No description.";

    // HEADER
    const header = this.detailsPanel.createDiv();
    header.style.cssText = "background:var(--interactive-accent); padding:10px 15px; display:flex; justify-content:space-between; align-items:center;";
    
    const typeSpan = header.createSpan();
    typeSpan.setText(type.toUpperCase());
    typeSpan.style.cssText = "font-weight:bold; color:white; font-size:0.9em;";

    const btnGroup = header.createDiv();
    btnGroup.style.display = "flex";
    btnGroup.style.gap = "10px";

    const editBtn = btnGroup.createEl("button");
    editBtn.setText("✏️ Edit");
    editBtn.style.cssText = "background:rgba(0,0,0,0.2); border:none; color:white; cursor:pointer; padding:2px 8px; border-radius:4px;";
    
    const closeBtn = btnGroup.createEl("button");
    closeBtn.setText("✕");
    closeBtn.style.cssText = "background:none; border:none; color:white; cursor:pointer; font-weight:bold;";
    closeBtn.onclick = () => { if (this.detailsPanel) this.detailsPanel.style.display = 'none'; };

    // BODY CONTAINER
    const content = this.detailsPanel.createDiv();
    content.style.padding = "15px";

    // VIEW MODE
    const viewMode = content.createDiv();
    
    const meta = viewMode.createDiv();
    meta.style.marginBottom = "10px";
    meta.createSpan({ text: "Links: ", attr: { style: "color:#aaa; font-size:0.8em;" } });
    meta.createEl("b", { text: String(node.val), attr: { style: "color:#fff" } });

    const title = viewMode.createEl("h2");
    title.setText(node.id);
    title.style.cssText = "margin:0 0 15px 0; color:#fff; word-break:break-word; line-height:1.2;";

    const descBox = viewMode.createDiv();
    descBox.style.cssText = "font-size:0.9em; line-height:1.6; color:#ccc; background:rgba(255,255,255,0.05); padding:10px; border-radius:6px; margin-bottom:15px; max-height:150px; overflow-y:auto; white-space:pre-wrap;";
    descBox.setText(desc);

    const sourcesSection = viewMode.createDiv();
    sourcesSection.style.cssText = "border-top:1px solid #333; padding-top:15px;";
    sourcesSection.createEl("h4", { text: "CONTEXT SOURCES", attr: { style: "margin:0 0 10px 0; color:#666; font-size:0.75em; letter-spacing:1px;" } });
    
    const ul = sourcesSection.createEl("ul");
    ul.style.cssText = "list-style:none; padding-left:0; margin:0;";

    if (files.length > 0) {
        files.forEach((f: string) => {
            const li = ul.createEl("li");
            li.style.cssText = "margin-bottom:4px; color:#66fcf1; display:flex; gap:6px;";
            li.createSpan({ text: "📄" });
            li.createSpan({ text: f });
        });
    } else {
        ul.createEl("li", { text: "No explicit source", attr: { style: "color:#666" } });
    }

    // EDIT MODE
    const editMode = content.createDiv();
    editMode.style.display = "none";
    
    const makeInput = (lbl: string, val: string) => {
        editMode.createEl("label", { text: lbl, attr: { style: "color:#aaa; font-size:0.8em; display:block; margin-bottom:4px;" } });
        const i = editMode.createEl("input");
        i.type = "text"; i.value = val;
        i.style.cssText = "width:100%; margin-bottom:10px; background:#333; color:white; border:1px solid #555; padding:4px;";
        return i;
    };

    const nameInput = makeInput("Name (ID)", node.id);
    const typeInput = makeInput("Type", type);
    
    editMode.createEl("label", { text: "Description", attr: { style: "color:#aaa; font-size:0.8em; display:block; margin-bottom:4px;" } });
    const descInput = editMode.createEl("textarea");
    descInput.value = desc; descInput.rows = 5;
    descInput.style.cssText = "width:100%; margin-bottom:10px; background:#333; color:white; border:1px solid #555; padding:4px;";

    const actions = editMode.createDiv();
    actions.style.cssText = "display:flex; justify-content:flex-end; gap:5px;";
    
    const cancelBtn = new ButtonComponent(actions).setButtonText("Cancel");
    const saveBtn = new ButtonComponent(actions).setButtonText("💾 Save");
    saveBtn.buttonEl.style.cssText = "background:var(--interactive-accent); color:white; border:none;";

    // Wiring
    editBtn.onclick = () => { viewMode.style.display='none'; editMode.style.display='block'; };
    cancelBtn.buttonEl.onclick = () => { editMode.style.display='none'; viewMode.style.display='block'; };
    
    saveBtn.buttonEl.onclick = async () => {
        const newName = nameInput.value.trim();
        if(newName) {
            await this.updateNode(node.id, { entity_name: newName, entity_type: typeInput.value.trim(), description: descInput.value.trim() });
            if(this.detailsPanel) this.detailsPanel.style.display = 'none';
        }
    };

    this.detailsPanel.style.display = 'block';
  }

async updateNode(oldName: string, data: any) {
      new Notice(`Updating node "${oldName}"...`);
      try {
          const response = await requestUrl({
              url: "http://localhost:9621/graph/entity/edit",
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ 
                  "entity_name": oldName, 
                  "updated_data": data, 
                  "allow_rename": true, 
                  "allow_merge": true 
              })
          });

          // requestUrl devuelve status 200 si todo sale bien
          if (response.status === 200) { 
              new Notice("✅ Node updated!"); 
              setTimeout(() => this.render(this.contentEl.querySelector('#sigma-container') as HTMLElement), 1500); 
          } else { 
              // response.text es una propiedad, no una promesa en Obsidian
              new Notice(`Error updating: ${response.text}`); 
          }
      } catch (e) { 
          console.error(e); 
          new Notice("API connection error"); 
      }
  }

  createGraphToolbar(container: HTMLElement, graphContainer: HTMLElement) {
      const tb = container.createDiv();
      // Reemplaza: absolute, top, left, z-index, display, gap
      tb.addClass('nrlcmp-toolbar');
      
      const searchInput = tb.createEl('input');
      searchInput.type = 'text'; 
      searchInput.placeholder = '🚀 Search...';
      
      // Reemplaza: background, border, color, padding, radius, outline, width...
      searchInput.addClass('nrlcmp-toolbar-input');
      
      searchInput.addEventListener('keydown', (e) => { 
          if (e.key === 'Enter') this.searchNode(searchInput.value); 
      });

      const btnReload = tb.createEl('button');
      setIcon(btnReload, 'refresh-cw'); 
      setTooltip(btnReload, 'Reload Graph');
      // Reemplaza estilos de botón
      btnReload.addClass('nrlcmp-toolbar-btn');
      btnReload.onclick = () => { void this.render(graphContainer); };
      
      const btnReset = tb.createEl('button');
      setIcon(btnReset, 'maximize'); 
      setTooltip(btnReset, 'Reset Camera');
      btnReset.addClass('nrlcmp-toolbar-btn');
      btnReset.onclick = () => { 
          if (this.graph3D) this.graph3D.zoomToFit(1000, 50); 
          if (this.sigmaInstance) this.sigmaInstance.getCamera().animate({ x: 0.5, y: 0.5, ratio: 0.1 }, { duration: 500 });
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
          
          const info = row.createDiv(); 
          info.style.flex = '1'; 
          info.style.marginLeft = '8px'; 
          info.style.cursor = 'pointer';
          
          // --- REFACTORIZADO (SECURITY): DOM API ---
          const title = info.createDiv();
          title.style.fontWeight = 'bold';
          title.setText(node.id);
          
          const meta = info.createDiv();
          meta.style.color = 'var(--text-muted)';
          meta.style.fontSize = '0.9em';
          // Fix visual
          const degree = node.val > 0 ? node.val - 1 : 0;
          meta.setText(`${node.type} (${degree})`);

          info.onclick = () => this.searchNode(node.id); 
      });
      
      if (this.filteredNodes.length > 100) {
          const more = this.sidebarListEl.createDiv();
          more.style.padding = '10px'; more.style.textAlign = 'center'; more.style.color = 'var(--text-muted)'; 
          more.setText(`...and ${this.filteredNodes.length - 100} more.`);
      }
  }
  
async mergeSelectedNodes() {
      const targets = Array.from(this.selectedNodes);
      if (targets.length < 2) { new Notice("Select 2+ nodes"); return; }
      
      new MergeSelectionModal(this.plugin.app, targets, async (targetNode: string, sourceNodes: string[]) => {
          new Notice(`Merging into ${targetNode}...`);
          try {
              const response = await requestUrl({
                  url: "http://localhost:9621/graph/entities/merge",
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ 
                      "entity_to_change_into": targetNode, 
                      "entities_to_change": sourceNodes 
                  })
              });

              if (response.status === 200) { 
                  new Notice("✅ Merged!"); 
                  this.selectedNodes.clear(); 
                  setTimeout(() => this.render(this.contentEl.querySelector('#sigma-container') as HTMLElement), 1000); 
              } else { 
                  new Notice(`Error: ${response.text}`); 
              }
          } catch (e) { console.error(e); new Notice("API Error"); }
      }).open();
  }

async deleteSelectedNodes() {
      const targets = Array.from(this.selectedNodes);
      if (targets.length === 0) return;
      if(!confirm(`Delete ${targets.length} nodes?`)) return;
      
      try {
          for (const entity of targets) {
              await requestUrl({
                  url: "http://localhost:9621/documents/delete_entity",
                  method: "DELETE",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ "entity_name": entity })
              });
          }
          new Notice("Deleted!"); 
          this.selectedNodes.clear();
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