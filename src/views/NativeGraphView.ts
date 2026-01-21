import { 
    ItemView, 
    WorkspaceLeaf, 
    Notice, 
    setIcon, 
    TextComponent, 
    ButtonComponent, 
    setTooltip, 
    requestUrl, 
    Modal, 
    App 
} from 'obsidian';
import * as fs from 'fs';
import * as path from 'path';
import { XMLParser } from 'fast-xml-parser';
import Graph from 'graphology';
// @ts-ignore - Graphology types might be missing in dev env
import { parse } from 'graphology-graphml';
import Sigma from 'sigma';
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
  getDisplayText() { return 'Neural manager'; }
  getIcon() { return 'brain-circuit'; }

  async onOpen() {
    const container = this.contentEl;
    container.empty();
    
    container.addClass('nrlcmp-graph-view'); 
    
    // Apply mode-specific class for CSS background variables
    const is3D = this.plugin.settings.graphViewMode === '3d';
    container.addClass(is3D ? 'nrlcmp-mode-3d' : 'nrlcmp-mode-2d');

    await this.loadReferenceMaps();

    // LEFT ZONE (Graph)
    const graphZone = container.createDiv({ cls: 'nrlcmp-graph-zone' });
    
    const graphContainer = graphZone.createDiv({ cls: 'nrlcmp-sigma-container' });
    graphContainer.id = 'sigma-container';
    
    this.createGraphToolbar(graphZone, graphContainer);
    this.createDetailsPanel(graphZone);

    // RIGHT ZONE (Sidebar)
    const sidebar = container.createDiv({ cls: 'nrlcmp-sidebar' });
    this.buildSidebar(sidebar);

    // Initial render
    setTimeout(() => { void this.render(graphContainer); }, 100);
  }

  // --- DATA LOGIC ---
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

  // --- MAIN RENDER ---
  async render(container: HTMLElement, label?: HTMLElement) {
    this.cleanup();
    container.empty();

    if (!fs.existsSync(this.graphDataPath)) {
        if(label) label.innerText = "❌ No data";
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
        if(label) label.innerText = `${this.allNodes.length} nodes | ${validEdges.length} links | ${mode.toUpperCase()}`;

        if (mode === '3d') {
            this.render3D(container, this.allNodes, validEdges);
        } else {
            this.render2D(container, this.allNodes, validEdges);
        }

    } catch (e) { console.error(e); }
  }

  // --- HELPER 2D: PRECISE NAVIGATION ---
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

  // --- ENGINE 2D (SIGMA.JS) ---
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

        // --- EVENTS ---
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
            if(this.detailsPanel) this.detailsPanel.hide(); 
        });
    };
    requestAnimationFrame(initSigma);
  }

  // --- ENGINE 3D ---
  render3D(container: HTMLElement, nodes: any[], edges: any[]) {
      const gData = {
          nodes: nodes.map(n => ({ ...n, type: n.type })),
          links: edges.map((e: any) => ({ source: e.normalizedSource || e.source, target: e.normalizedTarget || e.target }))
      };
      
      // Note: ForceGraph3D colors still hardcoded as they interact with WebGL canvas directly,
      // usually these aren't CSS controllable, but we use variables for DOM elements.
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

  // --- UI COMPONENTS ---
  createDetailsPanel(container: HTMLElement) {
      this.detailsPanel = container.createDiv({ cls: 'nrlcmp-details-panel' });
  }

  showNodeDetails(node: any) {
    if (!this.detailsPanel) return;
    this.detailsPanel.empty();

    const files = node.file_paths || [];
    const type = node.node_type || node.type || "Unknown";
    const desc = node.desc || "No description.";

    // HEADER
    const header = this.detailsPanel.createDiv({ cls: 'nrlcmp-details-header' });
    
    header.createSpan({ text: type.toUpperCase(), cls: 'nrlcmp-details-type' });

    const btnGroup = header.createDiv({ cls: 'nrlcmp-btn-group' });

    const editBtn = btnGroup.createEl("button", { text: "✏️ Edit", cls: 'nrlcmp-details-btn' });
    
    const closeBtn = btnGroup.createEl("button", { text: "✕", cls: 'nrlcmp-details-close' });
    closeBtn.onclick = () => { if (this.detailsPanel) this.detailsPanel.hide(); };

    // BODY CONTAINER
    const content = this.detailsPanel.createDiv({ cls: 'nrlcmp-details-content' });

    // VIEW MODE
    const viewMode = content.createDiv();
    
    const meta = viewMode.createDiv({ cls: 'nrlcmp-details-meta' });
    meta.createSpan({ text: "Links: ", cls: 'nrlcmp-label' });
    meta.createEl("b", { text: String(node.val), cls: 'nrlcmp-value' });

    viewMode.createEl("h2", { text: node.id, cls: 'nrlcmp-details-title' });

    const descBox = viewMode.createDiv({ cls: 'nrlcmp-details-desc' });
    descBox.setText(desc);

    const sourcesSection = viewMode.createDiv({ cls: 'nrlcmp-sources-section' });
    sourcesSection.createEl("h4", { text: "Context sources", cls: 'nrlcmp-section-title' });
    
    const ul = sourcesSection.createEl("ul", { cls: 'nrlcmp-sources-list' });

    if (files.length > 0) {
        files.forEach((f: string) => {
            const li = ul.createEl("li", { cls: 'nrlcmp-source-item' });
            li.createSpan({ text: "📄" });
            li.createSpan({ text: f });
        });
    } else {
        ul.createEl("li", { text: "No explicit source", cls: 'nrlcmp-no-source' });
    }

    // EDIT MODE
    const editMode = content.createDiv({ cls: 'nrlcmp-edit-mode' });
    // Initially hidden via CSS or state, but here we use display toggle
    editMode.style.display = 'none';
    
    const makeInput = (lbl: string, val: string) => {
        editMode.createEl("label", { text: lbl, cls: 'nrlcmp-input-label' });
        const i = editMode.createEl("input", { cls: 'nrlcmp-input-text' });
        i.type = "text"; 
        i.value = val;
        return i;
    };

    const nameInput = makeInput("Name (ID)", node.id);
    const typeInput = makeInput("Type", type);
    
    editMode.createEl("label", { text: "Description", cls: 'nrlcmp-input-label' });
    const descInput = editMode.createEl("textarea", { cls: 'nrlcmp-input-area' });
    descInput.value = desc; 
    descInput.rows = 5;

    const actions = editMode.createDiv({ cls: 'nrlcmp-edit-actions' });
    
    const cancelBtn = new ButtonComponent(actions).setButtonText("Cancel");
    const saveBtn = new ButtonComponent(actions).setButtonText("💾 Save");
    saveBtn.buttonEl.addClass('mod-cta');

    // Wiring
    editBtn.onclick = () => { viewMode.style.display='none'; editMode.style.display='block'; };
    cancelBtn.buttonEl.onclick = () => { editMode.style.display='none'; viewMode.style.display='block'; };
    
    saveBtn.buttonEl.onclick = async () => {
        const newName = nameInput.value.trim();
        if(newName) {
            await this.updateNode(node.id, { entity_name: newName, entity_type: typeInput.value.trim(), description: descInput.value.trim() });
            if(this.detailsPanel) this.detailsPanel.hide();
        }
    };

    this.detailsPanel.show();
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

          if (response.status === 200) { 
              new Notice("✅ Node updated!"); 
              setTimeout(() => { void this.render(this.contentEl.querySelector('#sigma-container') as HTMLElement); }, 1500); 
          } else { 
              new Notice(`Error updating: ${response.text}`); 
          }
      } catch (e) { 
          console.error(e); 
          new Notice("API connection error"); 
      }
  }

  createGraphToolbar(container: HTMLElement, graphContainer: HTMLElement) {
      const tb = container.createDiv({ cls: 'nrlcmp-toolbar' });
      
      const searchInput = tb.createEl('input', { cls: 'nrlcmp-toolbar-input' });
      searchInput.type = 'text'; 
      searchInput.placeholder = '🚀 Search...';
      
      searchInput.addEventListener('keydown', (e) => { 
          if (e.key === 'Enter') this.searchNode(searchInput.value); 
      });

      const btnReload = tb.createEl('button', { cls: 'nrlcmp-toolbar-btn' });
      setIcon(btnReload, 'refresh-cw'); 
      setTooltip(btnReload, 'Reload Graph');
      btnReload.onclick = () => { void this.render(graphContainer); };
      
      const btnReset = tb.createEl('button', { cls: 'nrlcmp-toolbar-btn' });
      setIcon(btnReset, 'maximize'); 
      setTooltip(btnReset, 'Reset Camera');
      btnReset.onclick = () => { 
          if (this.graph3D) this.graph3D.zoomToFit(1000, 50); 
          if (this.sigmaInstance) this.sigmaInstance.getCamera().animate({ x: 0.5, y: 0.5, ratio: 0.1 }, { duration: 500 });
      };
  }

  buildSidebar(container: HTMLElement) {
      const header = container.createDiv({ cls: 'nrlcmp-sidebar-header' });
      
      header.createEl('h4', { text: 'Node manager' });
      
      const searchInput = new TextComponent(header); 
      searchInput.setPlaceholder('Filter list...'); 
      searchInput.inputEl.addClass('nrlcmp-full-width');
      searchInput.onChange((val) => this.filterList(val)); 
      this.searchInputEl = searchInput.inputEl;

      const actionButtons = header.createDiv({ cls: 'nrlcmp-sidebar-actions' });
      new ButtonComponent(actionButtons).setButtonText('Merge').setCta().onClick(() => { void this.mergeSelectedNodes(); });
      new ButtonComponent(actionButtons).setButtonText('Delete').setWarning().onClick(() => { void this.deleteSelectedNodes(); });

      const filterBar = header.createDiv({ cls: 'nrlcmp-sidebar-filters' });
      this.sortBtnEl = filterBar.createEl('span', { text: 'Sort: Degree ⬇', cls: 'nrlcmp-sort-btn' });
      this.sortBtnEl.onclick = () => this.toggleSort();
      
      const orphansBtn = filterBar.createEl('span', { text: 'Show orphans', cls: 'nrlcmp-orphans-btn' });
      setTooltip(orphansBtn, 'Show disconnected nodes');
      orphansBtn.onclick = () => this.filterOrphans();

      this.sidebarListEl = container.createDiv({ cls: 'nrlcmp-sidebar-list' });
  }

  toggleSort() { 
      this.sortAscending = !this.sortAscending; 
      if (this.sortBtnEl) this.sortBtnEl.textContent = `Sort: Degree ${this.sortAscending ? '⬆' : '⬇'}`; 
      this.filteredNodes.sort((a, b) => this.sortAscending ? a.val - b.val : b.val - a.val); 
      this.renderList(); 
  }
  
  filterOrphans() { 
      if (this.searchInputEl) this.searchInputEl.value = ''; 
      this.filteredNodes = this.allNodes.filter(n => n.val === 1); 
      this.renderList(); 
  }
  
  filterList(query: string) { 
      if (!query) { this.filteredNodes = this.allNodes; } 
      else { const q = query.toLowerCase(); this.filteredNodes = this.allNodes.filter(n => n.id.toLowerCase().includes(q)); } 
      this.renderList(); 
  }
  
  renderList() {
      if (!this.sidebarListEl) return;
      this.sidebarListEl.empty();
      const visibleNodes = this.filteredNodes.slice(0, 50);
      
      visibleNodes.forEach(node => {
          const row = this.sidebarListEl!.createDiv({ cls: 'nrlcmp-sidebar-row' });
          
          const cb = row.createEl('input', { type: 'checkbox' });
          cb.checked = this.selectedNodes.has(node.id);
          cb.onclick = (e) => { e.stopPropagation(); if (cb.checked) this.selectedNodes.add(node.id); else this.selectedNodes.delete(node.id); };
          
          const info = row.createDiv({ cls: 'nrlcmp-row-info' });
          
          info.createDiv({ text: node.id, cls: 'nrlcmp-row-title' });
          
          const degree = node.val > 0 ? node.val - 1 : 0;
          info.createDiv({ text: `${node.type} (${degree})`, cls: 'nrlcmp-row-meta' });

          info.onclick = () => this.searchNode(node.id); 
      });
      
      if (this.filteredNodes.length > 100) {
          this.sidebarListEl.createDiv({ 
              text: `...and ${this.filteredNodes.length - 100} more.`,
              cls: 'nrlcmp-list-more'
          });
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
                  setTimeout(() => { void this.render(this.contentEl.querySelector('#sigma-container') as HTMLElement); }, 1000); 
              } else { 
                  new Notice(`Error: ${response.text}`); 
              }
          } catch (e) { console.error(e); new Notice("API Error"); }
      }).open();
  }

  async deleteSelectedNodes() {
      const targets = Array.from(this.selectedNodes);
      if (targets.length === 0) return;
      
      // Replaced native confirm with Obsidian Modal
      new ConfirmationModal(this.plugin.app, `Delete ${targets.length} nodes?`, async () => {
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
              setTimeout(() => { void this.render(this.contentEl.querySelector('#sigma-container') as HTMLElement); }, 1000);
          } catch (e) { console.error(e); new Notice("Error deleting nodes"); }
      }).open();
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

// --- HELPER: Safe Confirmation Modal ---
class ConfirmationModal extends Modal {
    constructor(app: App, private message: string, private onConfirm: () => void) {
        super(app);
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h2', { text: 'Confirm action' });
        contentEl.createDiv({ text: this.message, cls: 'nrlcmp-confirm-msg' });

        const btnContainer = contentEl.createDiv({ cls: 'nrlcmp-modal-btns' });
        
        new ButtonComponent(btnContainer)
            .setButtonText('Cancel')
            .onClick(() => this.close());

        new ButtonComponent(btnContainer)
            .setButtonText('Confirm')
            .setWarning()
            .onClick(() => {
                this.onConfirm();
                this.close();
            });
    }

    onClose() {
        this.contentEl.empty();
    }
}