// ── app.js ────────────────────────────────────────────────────────────────────

let _nextNodeId = 1;
function _newCondition() {
  return { _id: _nextNodeId++, type: 'condition', field: '', operator: 'contains', value: '' };
}
function _newGroup(type) {
  return { _id: _nextNodeId++, type: type || 'AND', children: [] };
}
function _ensureNodeIds(node) {
  if (!node._id) node._id = _nextNodeId++;
  if (node.children) node.children.forEach(_ensureNodeIds);
}
function _collectInvalidIds(node, operators, out) {
  if (node.type === 'condition') {
    if (!node.field) { out.push(node._id); return; }
    const op = operators.find(o => o.value === node.operator);
    if (op && !op.noValue && (!node.value || !node.value.trim())) out.push(node._id);
    return;
  }
  const children = node.children || [];
  if (!children.length) { out.push(node._id); return; }
  for (const child of children) _collectInvalidIds(child, operators, out);
}
function _cloneNode(node) {
  const clone = JSON.parse(JSON.stringify(node));
  (function reassign(n) { n._id = _nextNodeId++; if (n.children) n.children.forEach(reassign); })(clone);
  return clone;
}

// ── FilterGroup component ─────────────────────────────────────────────────────

const FilterGroup = {
  name: 'FilterGroup',
  props: {
    node:      { type: Object, required: true },
    fields:    { type: Array,  default: () => [] },
    operators: { type: Array,  default: () => [] },
    depth:     { type: Number, default: 0 },
    invalidIds: { default: () => new Set() },
  },
  emits: ['remove', 'duplicate'],
  data() {
    return {
      fieldSearch:  {},  // idx → search string
      fieldDropOpen: {}, // idx → boolean
      maxMultiline: CONFIG.maxMultilineValues,
    };
  },
  methods: {
    addCondition() { this.node.children.push(_newCondition()); },
    addGroup()     { this.node.children.push(_newGroup('AND')); },
    remove(idx)    { this.node.children.splice(idx, 1); },
    duplicate(idx) { this.node.children.splice(idx + 1, 0, _cloneNode(this.node.children[idx])); },
    opMeta(op)     { return this.operators.find(o => o.value === op) || {}; },
    multilineCount(v) { return (v || '').split('\n').filter(l => l.trim()).length; },
    trimMultiline(child) {
      if (!child.value) return;
      const lines = child.value.split('\n');
      let count = 0, cutAt = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim()) { count++; if (count > this.maxMultiline) { cutAt = i; break; } }
      }
      if (cutAt !== -1) child.value = lines.slice(0, cutAt).join('\n');
    },
    openDrop(idx)  {
      this.fieldSearch[idx] = ''; this.fieldDropOpen[idx] = true;
      this.$nextTick(() => {
        const el = Array.isArray(this.$refs.fsInput) ? this.$refs.fsInput[0] : this.$refs.fsInput;
        if (el) el.focus();
      });
    },
    closeDrop(idx) { this.fieldDropOpen[idx] = false; },
    pickField(child, idx, f) { child.field = f; this.fieldDropOpen[idx] = false; },
    filteredFields(idx) {
      const q = (this.fieldSearch[idx] || '').toLowerCase();
      return q ? this.fields.filter(f => f.toLowerCase().includes(q)) : this.fields;
    },
  },
  template: `
    <div class="rounded-lg border" :data-filter-id="node._id"
      :class="depth===0 ? 'border-blue-200' : (invalidIds.has(node._id) ? 'border-red-400 bg-red-50' : 'border-gray-200')">
      <div class="flex items-center gap-2 px-3 py-2 rounded-t-lg border-b"
           :class="depth===0 ? 'bg-blue-50 border-blue-100' : 'bg-gray-50 border-gray-100'">
        <span class="text-xs text-gray-500 font-medium">Dopasuj</span>
        <button v-for="t in ['AND','OR']" :key="t" @click="node.type=t"
          class="px-2 py-0.5 text-xs font-bold rounded transition"
          :class="node.type===t
            ? (t==='AND' ? 'bg-blue-600 text-white' : 'bg-orange-500 text-white')
            : 'bg-white border border-gray-300 text-gray-500 hover:bg-gray-50'">{{ t }}</button>
        <button v-if="depth>0" @click="$emit('duplicate')" title="Duplikuj grupę"
          class="ml-auto text-gray-400 hover:text-blue-500 transition p-0.5">
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
        </button>
        <button v-if="depth>0" @click="$emit('remove')"
          class="text-gray-400 hover:text-red-500 transition p-0.5">
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="p-2 space-y-2">
        <template v-for="(child, idx) in node.children" :key="child._id">
          <div v-if="child.type==='condition'" :data-filter-id="child._id"
            class="rounded-lg p-2 space-y-1.5 border"
            :class="invalidIds.has(child._id) ? 'border-red-400 bg-red-50' : 'border-gray-200 bg-gray-50'">
            <div class="flex items-center gap-1.5">

              <!-- Field picker (searchable combobox) -->
              <div class="relative flex-1 min-w-0">
                <!-- Backdrop closes dropdown on outside click -->
                <div v-if="fieldDropOpen[idx]" class="fixed inset-0 z-20" @click="closeDrop(idx)"></div>
                <!-- Trigger button -->
                <button type="button" @click="fieldDropOpen[idx] ? closeDrop(idx) : openDrop(idx)"
                  class="w-full text-left text-xs border rounded px-2 py-1.5 bg-white flex items-center gap-1 min-w-0"
                  :class="[child.field ? 'text-gray-800' : 'text-gray-400', (child._sourceHint && !child.field) ? 'border-amber-400' : 'border-gray-300']">
                  <span class="flex-1 truncate">{{ child.field || '-- wybierz pole --' }}</span>
                  <svg class="w-3 h-3 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19.5 8.25l-7.5 7.5-7.5-7.5"/></svg>
                </button>
                <!-- Dropdown -->
                <div v-if="fieldDropOpen[idx]" class="absolute z-30 top-full left-0 mt-0.5 bg-white border border-gray-200 rounded-lg shadow-xl w-full min-w-[200px]" @click.stop>
                  <div class="p-1.5 border-b border-gray-100">
                    <input :value="fieldSearch[idx] || ''" @input="fieldSearch[idx] = $event.target.value"
                      placeholder="Szukaj pola..."
                      class="w-full text-xs px-2 py-1.5 border border-gray-200 rounded focus:outline-none focus:border-blue-400"
                      ref="fsInput">
                  </div>
                  <div class="max-h-52 overflow-y-auto">
                    <button v-for="f in filteredFields(idx)" :key="f" type="button"
                      @click="pickField(child, idx, f)"
                      class="block w-full text-left text-xs px-3 py-1.5 hover:bg-blue-50 truncate transition"
                      :class="child.field===f ? 'text-blue-600 font-medium bg-blue-50' : 'text-gray-700'">
                      {{ f }}
                    </button>
                    <div v-if="!filteredFields(idx).length" class="text-xs text-gray-400 px-3 py-2">Brak wyników</div>
                  </div>
                </div>
              </div>

              <button @click="duplicate(idx)" title="Duplikuj warunek"
                class="flex-shrink-0 text-gray-400 hover:text-blue-500 transition p-0.5">
                <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
              </button>
              <button @click="remove(idx)" title="Usuń warunek"
                class="flex-shrink-0 text-gray-400 hover:text-red-500 transition p-0.5">
                <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
              </button>
            </div>
            <div v-if="child._sourceHint" class="flex items-start gap-1 text-[10px] leading-tight"
              :class="child.field ? 'text-gray-400' : 'text-amber-600'">
              <svg class="w-3 h-3 flex-shrink-0 mt-px" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"/></svg>
              <span v-if="!child.field">w systemie: <strong>{{ child._sourceHint }}</strong> — wybierz pole ręcznie</span>
              <span v-else>z: <strong>{{ child._sourceHint }}</strong> → {{ child.field }} (auto — sprawdź)</span>
            </div>
            <div class="flex items-center gap-1.5">
              <select v-model="child.operator"
                class="flex-shrink-0 text-xs border border-gray-300 rounded px-2 py-1.5 bg-white">
                <option v-for="op in operators" :value="op.value" :key="op.value">{{ op.label }}</option>
              </select>
              <template v-if="!opMeta(child.operator).noValue">
                <button type="button" @click="child.multiline = false" title="Pojedyncza wartość"
                  class="flex items-center justify-center w-6 h-6 rounded transition"
                  :class="!child.multiline ? 'bg-blue-600 text-white' : 'bg-white border border-gray-300 text-gray-500 hover:bg-gray-50'">
                  <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 6h12M12 6v12"/></svg>
                </button>
                <button type="button" @click="child.multiline = true" title="Lista wartości (jedna na linię)"
                  class="flex items-center justify-center w-6 h-6 rounded transition"
                  :class="child.multiline ? 'bg-blue-600 text-white' : 'bg-white border border-gray-300 text-gray-500 hover:bg-gray-50'">
                  <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>
                </button>
              </template>
            </div>
            <div v-if="!opMeta(child.operator).noValue">
              <input v-if="!child.multiline"
                v-model="child.value"
                :placeholder="opMeta(child.operator).mono ? 'wyrażenie...' : 'wartość...'"
                class="w-full text-xs border border-gray-300 rounded px-2 py-1.5"
                :class="opMeta(child.operator).mono ? 'font-mono bg-white' : ''">
              <template v-else>
                <textarea v-model="child.value" @input="trimMultiline(child)" rows="3" placeholder="jedna wartość na linię…"
                  class="w-full text-xs border border-gray-300 rounded px-2 py-1.5 font-mono resize-y"></textarea>
                <p class="text-[10px] mt-1" :class="multilineCount(child.value) >= maxMultiline ? 'text-amber-600' : 'text-gray-400'">
                  {{ multilineCount(child.value) }} / {{ maxMultiline }}
                  <span v-if="multilineCount(child.value) >= maxMultiline">— przycięto</span>
                </p>
              </template>
            </div>
          </div>
          <filter-group v-else :node="child" :fields="fields" :operators="operators"
            :depth="depth+1" :invalid-ids="invalidIds" @remove="remove(idx)" @duplicate="duplicate(idx)" />
        </template>
        <div class="flex gap-2 pt-0.5">
          <button @click="addCondition"
            class="text-xs px-2 py-1 rounded border border-dashed border-gray-300 text-gray-500 hover:border-blue-400 hover:text-blue-600 transition">
            + Warunek</button>
          <button @click="addGroup"
            class="text-xs px-2 py-1 rounded border border-dashed border-gray-300 text-gray-500 hover:border-purple-400 hover:text-purple-600 transition">
            + Grupa</button>
        </div>
      </div>
    </div>
  `,
};
FilterGroup.components = { FilterGroup };

// ── Main app ──────────────────────────────────────────────────────────────────

const { createApp, toRaw } = Vue;

const app = createApp({
  data() {
    return {
      config: CONFIG,
      changelog: typeof CHANGELOG !== 'undefined' ? CHANGELOG : [],
      showChangelog: false,
      screen: 'list',  // 'list' | 'import' | 'project'

      // List
      projects:      [],
      projectSearch: '',
      projectPage:   1,
      confirmDelete:    null,
      confirmDeleteAll: false,

      // Import
      reimportProject:  null,
      importName:       '',
      importFile:       null,
      importFileHandle: null,
      importing:        false,
      importProgress:   0,
      importItemCount:  0,
      importError:      null,
      importWarnings:   [],
      importElapsed:    0,
      _importStartTime: 0,
      _importTimer:     null,
      detectedTags:     [],   // [{tag, count, isProduct}]
      selectedTag:      '',
      detectingTags:    false,
      supportsFileApi:  typeof window.showOpenFilePicker === 'function',
      _worker:               null,
      _workerUrl:            null,
      _pendingStreamPreview: null,

      // Project view
      activeProject:    null,
      fileNeeded:       false,   // true when file handle is missing/denied
      projectError:     null,    // non-null when IDB or worker error in project view
      renamingProject:  false,
      renameValue:      '',

      // Filter
      filterRoot:     _newGroup('AND'),
      filterInvalidIds:    new Set(),
      filterValidationActive: false,
      savedFilters:   [],
      showSaveFilter: false,
      saveFilterName: '',
      showRuleImport: false,
      ruleImportText: '',

      // Indexing (background processing after early project open)
      indexing:           false,
      indexingProgress:   0,
      indexingScanned:    0,
      indexingElapsed:    0,
      _indexingStartTime: 0,
      _indexingTimer:     null,

      // Results
      filterResults:   [],
      filterTruncated: false,
      filtering:       false,

      // Per-branch breakdown (top-level OR branches of the applied filter)
      appliedBranches:        [],   // deep-cloned OR branches captured at apply time
      showBreakdown:          false, // gray breakdown row toggled from the results bar
      activeBranchIndex:      null, // drill-down: null = combined, else branch index
      branchCounts:           [],
      branchCountsComputed:   false,
      branchCounting:         false,
      branchCountUnavailable: false, // case B in stream mode (>250k) — counts not available

      filterScanned:   0,
      filterTotal:        0,    // total scanned (from done.scanned) after filter run
      filterMatchedTotal: 0,    // total matched (may exceed filterResults if capped)
      filterBytes:     0,
      filterBytesTotal:0,
      filterStartTime: 0,
      filterElapsed:   0,
      _filterTimer:    null,
      fullExporting:      false,
      fullExportProgress: 0,
      page:            1,

      // Table
      visibleFields:    [],
      sortField:        null,
      sortDir:          'asc',
      showColumnPicker: false,

      // Detail panel
      selectedItem: null,
      copiedKey:    null,

      // Quick search within loaded results
      quickSearch: '',
    };
  },

  watch: {
    filterRoot: {
      deep: true,
      handler() {
        // Editing the filter invalidates any computed breakdown / drill-down
        if (this.branchCountsComputed || this.activeBranchIndex !== null) this._resetBranchState();
        if (!this.filterValidationActive) return;
        const ids = [];
        _collectInvalidIds(this.filterRoot, CONFIG.operators, ids);
        this.filterInvalidIds = new Set(ids);
        if (!ids.length) this.filterValidationActive = false;
      },
    },
  },

  computed: {
    operators()      { return CONFIG.operators; },
    availableFields(){ return this.activeProject?.fields || []; },
    hasFilter()      { return this.filterRoot.children.length > 0; },
    isIdbMode()      { return this.activeProject && this.activeProject.fileSize < CONFIG.idbSizeLimit; },

    ruleImportResult() {
      if (!this.ruleImportText.trim()) return null;
      try { return convertExcludeRules(this.ruleImportText, this.availableFields); }
      catch (e) {
        return { tree: null, ruleTrees: [], ok: false, ruleCount: 0, imported: 0, skipped: 0,
                 skippedReasons: [], warnings: [], errors: ['Błąd konwersji: ' + e.message],
                 unmapped: [], softMapped: [] };
      }
    },

    filteredProjects() {
      const q = this.projectSearch.trim().toLowerCase();
      const sorted = [...this.projects].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      if (!q) return sorted;
      return sorted.filter(p =>
        p.name.toLowerCase().includes(q) || (p.filename || '').toLowerCase().includes(q)
      );
    },

    totalProjectPages() {
      return Math.max(1, Math.ceil(this.filteredProjects.length / CONFIG.pageSize));
    },

    pagedProjects() {
      const s = (this.projectPage - 1) * CONFIG.pageSize;
      return this.filteredProjects.slice(s, s + CONFIG.pageSize);
    },

    selectedItemFields() {
      if (!this.selectedItem) return [];
      return Object.entries(this.selectedItem).filter(([k, v]) => {
        if (k.startsWith('_')) return false;
        if (v === null || v === undefined) return false;
        if (Array.isArray(v)) return v.some(x => String(x).trim() !== '');
        return String(v).trim() !== '';
      });
    },

    // Top-level OR branches of the applied filter (empty unless root is OR with >1 child)
    filterBranches() { return this.appliedBranches; },
    resultsTruncated() { return this.filterMatchedTotal > this.filterResults.length; },
    displayedCount() {
      return this.activeBranchIndex === null ? this.filterResults.length : this.branchResults.length;
    },

    // Results narrowed to the active branch (drill-down). Case A only: filterResults holds
    // the complete matched set, and each OR branch ⊆ that set, so client-side filtering is exact.
    branchResults() {
      if (this.activeBranchIndex === null) return this.filterResults;
      const b = this.appliedBranches[this.activeBranchIndex];
      if (!b) return this.filterResults;
      return this.filterResults.filter(item => evaluateFilter(item, b));
    },

    sortedResults() {
      const base = this.branchResults;
      if (!this.sortField || base.length > 5000) return base;
      return [...base].sort((a, b) => {
        const va = String(a[this.sortField] ?? '');
        const vb = String(b[this.sortField] ?? '');
        return this.sortDir === 'asc' ? va.localeCompare(vb, 'pl') : vb.localeCompare(va, 'pl');
      });
    },

    searchedResults() {
      const q = this.quickSearch.trim().toLowerCase();
      if (!q) return this.sortedResults;
      const searchFields = this.availableFields.filter(f => {
        const fl = f.toLowerCase().replace(/[^a-z]/g, '');
        return fl.includes('id') || fl.includes('title') || fl.includes('link') || fl.includes('url');
      });
      if (!searchFields.length) return this.sortedResults;
      return this.sortedResults.filter(item =>
        searchFields.some(f => String(item[f] || '').toLowerCase().includes(q))
      );
    },

    pagedResults() {
      const s = (this.page - 1) * CONFIG.pageSize;
      return this.searchedResults.slice(s, s + CONFIG.pageSize);
    },

    totalPages() {
      return Math.max(1, Math.ceil(this.searchedResults.length / CONFIG.pageSize));
    },
  },

  methods: {
    // ── navigation ────────────────────────────────────────────────────────────
    async goToList() {
      if (this._worker) { this._worker.terminate(); this._worker = null; }
      if (this._workerUrl) { URL.revokeObjectURL(this._workerUrl); this._workerUrl = null; }
      if (this._filterSignal) { this._filterSignal.cancelled = true; this._filterSignal = null; }
      this.fullExporting = false;
      if (this.activeProject) {
        if (this._isIdbMode(this.activeProject)) {
          this._lastIdbProjectId = this.activeProject.id;
        }
        // Persist active filter and visible columns
        const update = toRaw(this.activeProject);
        update.lastFilter     = this.hasFilter ? JSON.parse(JSON.stringify(this.filterRoot)) : null;
        update.visibleFields  = [...this.visibleFields];
        await saveProject(update).catch(() => {});
      }
      this.screen        = 'list';
      history.replaceState(null, '', location.pathname);
      this.activeProject = null;
      this.selectedItem  = null;
      this.filterResults = [];
      this.appliedBranches = [];
      this._resetBranchState();
      this._stopIndexingTimer();
      this.indexing       = false;
      this.projects      = await getProjects();
    },

    startRename() {
      this.renameValue    = this.activeProject.name;
      this.renamingProject = true;
      this.$nextTick(() => this.$refs.renameInput?.select());
    },
    cancelRename() {
      this.renamingProject = false;
    },
    async commitRename() {
      if (!this.renamingProject) return;
      this.renamingProject = false;
      const name = this.renameValue.trim();
      if (name && name !== this.activeProject.name) {
        this.activeProject.name = name;
        await saveProject(toRaw(this.activeProject));
      }
    },

    async openProject(project) {
      this.activeProject   = project;
      this.savedFilters    = await getSavedFilters(project.id);
      this.filterResults   = [];
      this.filterTruncated = false;
      this.filterTotal     = 0;
      this.selectedItem    = null;
      this.page            = 1;
      this.sortField       = null;
      this.quickSearch     = '';
      this.fileNeeded      = false;
      this.projectError    = null;
      this.renamingProject = false;

      // Restore saved filter or start fresh
      if (project.lastFilter) {
        this.filterRoot = project.lastFilter;
        _ensureNodeIds(this.filterRoot);
      } else {
        this.filterRoot = _newGroup('AND');
      }

      // Restore saved columns or compute defaults
      const fields = project.fields || [];
      if (project.visibleFields?.length) {
        this.visibleFields = project.visibleFields.filter(f => fields.includes(f));
      }
      if (!this.visibleFields.length) {
        const preferred = ['g:id','id','g:image_link','image_link','title','g:title',
                           'g:availability','availability','link','url',
                           'g:product_type','product_type',
                           'g:price','price','g:sale_price','sale_price'];
        const excluded  = new Set(['g:description','description',
                                    'g:additional_image_link','additional_image_link',
                                    'g:color','color',
                                    'g:brand','brand',
                                    'g:condition','condition']);
        const defaults  = preferred.filter(f => fields.includes(f));
        const rest      = fields.filter(f => !defaults.includes(f) && !excluded.has(f));
        this.visibleFields = [...defaults, ...rest].slice(0, 8);
      }
      this.screen    = 'project';
      if (project.id) history.replaceState(null, '', '#project-' + project.id);

      if (this._pendingStreamPreview) {
        // Early open from runImport — show preview directly (both modes)
        this.filterResults   = this._pendingStreamPreview;
        this.filterTruncated = false;
        this.page            = 1;
      } else if (this._isIdbMode(project)) {
        try {
          // Clear IDB of previous project if opening a different one
          if (this._lastIdbProjectId && this._lastIdbProjectId !== project.id) {
            await clearProjectItems(this._lastIdbProjectId).catch(() => {});
          }
          this._lastIdbProjectId = project.id;
          const existing = await getFirstItems(project.id, 1);
          if (!existing.length) {
            let file = await this._getFile(project);
            if (!file && this.importFile?.name === project.filename) file = this.importFile;
            if (!file) { this.fileNeeded = true; return; }
            await this._populateIdb(file);
          }
          this.filterResults   = await getFirstItems(project.id, CONFIG.maxFilterResults);
          this.filterMatchedTotal = this.activeProject?.itemCount || this.filterResults.length;
          this.filterTruncated = false;
          this.page            = 1;
        } catch (e) {
          this.projectError = e.message || 'Błąd odczytu bazy danych (IndexedDB).';
        }
      } else {
        let file = await this._getFile(project);
        if (!file && this.importFile?.name === project.filename) file = this.importFile;
        if (!file) { this.fileNeeded = true; return; }
        await this._loadFromFile(file, null, CONFIG.previewLimit);
      }

      // Re-apply restored filter
      if (this.hasFilter) await this.applyFilter();
    },

    startNewImport() {
      this.reimportProject  = null;
      this.importName       = '';
      this.importFile       = null;
      this.importFileHandle = null;
      this.importProgress   = 0;
      this.importItemCount  = 0;
      this.importError      = null;
      this.detectedTags     = [];
      this.selectedTag      = '';
      this.screen           = 'import';
    },

    startReimport(project) {
      this.reimportProject  = project;
      this.importName       = project.name;
      this.importFile       = null;
      this.importFileHandle = null;
      this.importProgress   = 0;
      this.importItemCount  = 0;
      this.importError      = null;
      this.detectedTags     = [];
      this.selectedTag      = '';
      this.screen           = 'import';
    },

    // ── schema helpers ────────────────────────────────────────────────────────

    // Returns a plain schema object regardless of how it's stored (string key or object)
    _getSchema(project) {
      const s = project?.schema;
      if (!s) return SCHEMAS.google;
      if (typeof s === 'string') return SCHEMAS[s] || SCHEMAS.google;
      return s;
    },

    async _detectTags(file) {
      this.detectedTags  = [];
      this.selectedTag   = '';
      this.detectingTags = true;
      return new Promise((resolve) => {
        const worker = this._createWorker();
        worker.onmessage = ({ data }) => {
          if (data.type === 'done') {
            this.detectingTags = false;
            this.detectedTags  = data.candidates.slice(0, 12);
            // For reimport: keep previous tag if still detected
            const prev = this._getSchema(this.reimportProject)?.itemTags?.[0];
            this.selectedTag = (prev && this.detectedTags.find(c => c.tag === prev))
              ? prev
              : (data.candidates[0]?.tag || '');
            worker.terminate();
            this._worker = null;
            URL.revokeObjectURL(this._workerUrl); this._workerUrl = null;
            resolve();
          }
        };
        worker.onerror = () => {
          this.detectingTags = false;
          worker.terminate();
          this._worker = null;
          URL.revokeObjectURL(this._workerUrl); this._workerUrl = null;
          resolve();
        };
        this._postWorker(worker, { detectTags: true, file });
      });
    },

    // ── file access ───────────────────────────────────────────────────────────

    async _getFile(project) {
      // toRaw needed: Vue wraps fileHandle in Proxy, native FS API rejects Proxy as `this`
      const handle = toRaw(project?.fileHandle);
      if (!handle) return null;
      try {
        const perm = await handle.requestPermission({ mode: 'read' });
        if (perm === 'granted') return await handle.getFile();
      } catch (_) {}
      return null;
    },

    // ── worker ────────────────────────────────────────────────────────────────

    // Sends a message to the worker, stripping all Vue reactive proxies from the payload.
    // `file` (File/Blob) is not JSON-serializable, so it's handled separately via toRaw().
    // Everything else is deep-cloned through JSON to strip any reactive Proxy wrappers.
    _postWorker(worker, { file, ...rest }) {
      worker.postMessage({ file: toRaw(file), ...JSON.parse(JSON.stringify(rest)) });
    },

    _createWorker() {
      if (this._worker) { this._worker.terminate(); }
      if (this._workerUrl) { URL.revokeObjectURL(this._workerUrl); }
      const src  = document.getElementById('feed-worker-src').textContent;
      const url  = URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));
      const w    = new Worker(url);
      this._worker    = w;
      this._workerUrl = url;
      return w;
    },

    async _loadFromFile(file, filterTree, limit) {
      this.filtering      = true;
      this.filterScanned  = 0;
      this.filterResults  = [];
      this.filterTotal    = 0;
      this.filterBytes    = 0;
      this.filterBytesTotal = file.size;
      this.page           = 1;
      this.selectedItem   = null;
      this._startTimer();

      const schema = JSON.parse(JSON.stringify(this._getSchema(this.activeProject)));

      return new Promise((resolve, reject) => {
        const worker = this._createWorker();
        worker.onerror = (e) => {
          this.filtering = false;
          this._worker   = null;
          reject(new Error(e.message || 'Błąd workera'));
        };
        worker.onmessage = ({ data }) => {
          if (data.type === 'progress') {
            this.filterScanned = data.count;
            this.filterBytes   = data.bytes;
          } else if (data.type === 'batch') {
            this.filterResults.push(...data.items);
          } else if (data.type === 'done') {
            this._stopTimer();
            this.filtering          = false;
            this.filterTotal        = data.scanned;
            this.filterMatchedTotal = data.count;
            this._worker     = null;
            URL.revokeObjectURL(this._workerUrl); this._workerUrl = null;
            resolve(data);
          } else if (data.type === 'error') {
            this._stopTimer();
            this.filtering = false;
            this._worker   = null;
            URL.revokeObjectURL(this._workerUrl); this._workerUrl = null;
            reject(new Error(data.message));
          }
        };
        this._postWorker(worker, {
          file,
          schema,
          config:      { chunkSize: CONFIG.chunkSize, batchSize: CONFIG.workerBatchSize },
          filter:      filterTree || null,
          limit:       limit      || null,
          resultLimit: filterTree ? CONFIG.maxFilterResults : null,
        });
      });
    },

    // ── import ────────────────────────────────────────────────────────────────

    async pickFileWithApi() {
      try {
        const [handle] = await window.showOpenFilePicker({
          types: [{ description: 'XML Feed', accept: { 'application/xml': ['.xml'], 'text/xml': ['.xml'] } }],
        });
        this.importFileHandle = handle;
        this.importFile       = await handle.getFile();
        this.importError      = null;
        if (!this.importName.trim() && !this.reimportProject) {
          this.importName = this.importFile.name.replace(/\.xml$/i, '');
        }
        await this._detectTags(this.importFile);
      } catch (e) {
        if (e.name !== 'AbortError') this.importError = e.message;
      }
    },

    async onFileChange(e) {
      this.importFileHandle = null;
      this.importFile       = e.target.files[0] || null;
      this.importError      = null;
      if (this.importFile && !this.importName.trim() && !this.reimportProject) {
        this.importName = this.importFile.name.replace(/\.xml$/i, '');
      }
      if (this.importFile) await this._detectTags(this.importFile);
    },

    async runImport() {
      if (!this.importFile)        { this.importError = 'Wybierz plik XML przed importem.'; return; }
      if (!this.importName.trim()) { this.importError = 'Podaj nazwę projektu.'; return; }
      if (!this.selectedTag)       { this.importError = 'Wybierz tag produktu.'; return; }

      this.importing        = true;
      this.importProgress   = 0;
      this.importItemCount  = 0;
      this.importError      = null;
      this.importWarnings   = [];
      this.importElapsed    = 0;
      this._importStartTime = Date.now();
      if (this._importTimer) clearInterval(this._importTimer);
      this._importTimer = setInterval(() => { this.importElapsed = Date.now() - this._importStartTime; }, 200);

      try {
        const schema = { itemTags: [this.selectedTag], nestedSeparator: '.', maxDepth: 4 };
        const isIdb  = this.importFile.size < CONFIG.idbSizeLimit;

        // IDB mode: pre-save draft project to get an ID so batches can be inserted immediately.
        // Stream mode: no IDB insertion — use discoverOnly to get fields/count only.
        let preId = null;
        if (isIdb) {
          if (this.reimportProject?.id) {
            preId = this.reimportProject.id;
            await clearProjectItems(preId);
          } else {
            preId = await saveProject({
              name: this.importName.trim(), filename: this.importFile.name,
              fileSize: this.importFile.size, fileHandle: this.importFileHandle || null,
              schema, createdAt: Date.now(), updatedAt: Date.now(),
            });
          }
        }

        const worker       = this._createWorker();
        const inserts      = [];
        const previewItems = [];
        let   earlyOpened  = false;

        worker.onerror = (e) => {
          this.importError = e.message || 'Błąd workera';
          this._stopImportTimer();
          this._stopIndexingTimer();
          this.importing = false;
          this.indexing  = false;
          this._worker   = null;
        };

        worker.onmessage = async ({ data }) => {
          if (data.type === 'progress') {
            if (!earlyOpened) {
              this.importProgress  = Math.round(data.bytes / data.total * 100);
              this.importItemCount = data.count;
            } else {
              this.indexingProgress = Math.round(data.bytes / data.total * 100);
              this.indexingScanned  = data.count;
            }

          } else if (data.type === 'warn') {
            this.importWarnings.push(data.message);

          } else if (data.type === 'batch') {
            if (isIdb) inserts.push(insertItems(preId, data.items));

            // Collect preview items; early-open project after enough arrive
            if (!earlyOpened) {
              previewItems.push(...data.items);
              if (previewItems.length >= CONFIG.previewLimit) {
                earlyOpened = true;
                const partialFields = [...new Set(previewItems.flatMap(it => Object.keys(it).filter(k => !k.startsWith('_'))))].sort();
                const projectData = {
                  name: this.importName.trim(), filename: this.importFile.name,
                  fileSize: this.importFile.size, fileHandle: this.importFileHandle || null,
                  schema, itemCount: previewItems.length, fields: partialFields,
                  createdAt: this.reimportProject?.createdAt || Date.now(), updatedAt: Date.now(),
                };
                if (preId) projectData.id = preId;
                if (this.reimportProject?.id) projectData.id = this.reimportProject.id;
                if (!isIdb) {
                  const savedId = await saveProject(projectData);
                  if (!projectData.id) projectData.id = savedId;
                }
                this._stopImportTimer();
                this.importing        = false;
                this.indexing         = true;
                this.indexingProgress = 0;
                this.indexingScanned  = previewItems.length;
                this._startIndexingTimer();
                this._pendingStreamPreview = previewItems.slice(0, CONFIG.previewLimit);
                try { await this.openProject(projectData); }
                finally { this._pendingStreamPreview = null; }
              }
            }

          } else if (data.type === 'done') {
            if (data.count === 0) {
              this.importError = `Nie znaleziono rekordów. Sprawdź schemat parsowania (szukano tagu: ${this.selectedTag}).`
                + (data.skipped ? ` Pominięto ${data.skipped} uszkodzonych rekordów.` : '');
              this._stopImportTimer(); this._stopIndexingTimer();
              this.importing = false; this.indexing = false;
              this._worker = null;
              URL.revokeObjectURL(this._workerUrl); this._workerUrl = null;
              if (isIdb && preId && !this.reimportProject?.id) deleteProject(preId).catch(() => {});
              return;
            }

            if (inserts.length) await Promise.all(inserts);
            this._worker = null;
            URL.revokeObjectURL(this._workerUrl); this._workerUrl = null;

            if (!earlyOpened) {
              // Small file (< previewLimit items) — never early-opened, use original flow
              this._stopImportTimer();
              const projectData = {
                name: this.importName.trim(), filename: this.importFile.name,
                fileSize: this.importFile.size, fileHandle: this.importFileHandle || null,
                schema, itemCount: data.count, skipped: data.skipped, fields: data.fields,
                processingTime: this.importElapsed,
                createdAt: this.reimportProject?.createdAt || Date.now(), updatedAt: Date.now(),
              };
              if (preId) projectData.id = preId;
              if (this.reimportProject?.id) projectData.id = this.reimportProject.id;
              const savedId = await saveProject(projectData);
              if (!projectData.id) projectData.id = savedId;
              this.importing = false;
              if (previewItems.length) this._pendingStreamPreview = previewItems;
              try { await this.openProject(projectData); }
              finally { this._pendingStreamPreview = null; }
            } else {
              // Early-opened — update project with final metadata
              if (this.activeProject) {
                this.activeProject.itemCount      = data.count;
                this.activeProject.skipped        = data.skipped;
                this.activeProject.fields         = data.fields;
                this.activeProject.processingTime = Date.now() - this._importStartTime;
                this.activeProject.updatedAt      = Date.now();
                await saveProject(toRaw(this.activeProject));
              }
              // Refresh full item list for IDB mode
              if (isIdb && this.activeProject) {
                this.filterResults   = await getFirstItems(this.activeProject.id, CONFIG.maxFilterResults);
          this.filterMatchedTotal = this.activeProject?.itemCount || this.filterResults.length;
                this.filterTruncated = false;
              }
              this._stopIndexingTimer();
              this.indexing = false;
            }

          } else if (data.type === 'error') {
            this.importError = data.message;
            this._stopImportTimer(); this._stopIndexingTimer();
            this.importing = false; this.indexing = false;
            this._worker = null;
            URL.revokeObjectURL(this._workerUrl); this._workerUrl = null;
          }
        };

        this._postWorker(worker, {
          file:         this.importFile,
          schema,
          config:       { chunkSize: CONFIG.chunkSize, batchSize: CONFIG.workerBatchSize },
          discoverOnly: !isIdb,
          filter:       null,
          limit:        isIdb ? null : CONFIG.previewLimit,
        });

      } catch (err) {
        this.importError = err.message;
        this.importing   = false;
      }
    },

    cancelFilter() {
      if (this._worker) { this._worker.terminate(); this._worker = null; }
      if (this._workerUrl) { URL.revokeObjectURL(this._workerUrl); this._workerUrl = null; }
      if (this._filterSignal) { this._filterSignal.cancelled = true; this._filterSignal = null; }
      this._stopTimer();
      this.filtering = false;
    },

    cancelImport() {
      if (this._worker) { this._worker.terminate(); this._worker = null; }
      if (this._workerUrl) { URL.revokeObjectURL(this._workerUrl); this._workerUrl = null; }
      this._stopImportTimer();
      this.importing = false;
      this.goToList();
    },

    async cancelIndexing() {
      if (this._worker) { this._worker.terminate(); this._worker = null; }
      if (this._workerUrl) { URL.revokeObjectURL(this._workerUrl); this._workerUrl = null; }
      this._stopIndexingTimer();
      this.indexing = false;
      // Load whatever was already inserted into IDB before cancellation
      if (this.activeProject && this._isIdbMode(this.activeProject)) {
        this.filterResults   = await getFirstItems(this.activeProject.id, CONFIG.maxFilterResults);
          this.filterMatchedTotal = this.activeProject?.itemCount || this.filterResults.length;
        this.filterTruncated = false;
        this.activeProject.itemCount = this.filterResults.length;
        await saveProject(toRaw(this.activeProject));
      }
    },

    // ── re-select file (when fileHandle is missing) ───────────────────────────

    async reSelectFile() {
      if (this.supportsFileApi) {
        try {
          const [handle] = await window.showOpenFilePicker({
            types: [{ description: 'XML Feed', accept: { 'application/xml': ['.xml'], 'text/xml': ['.xml'] } }],
          });
          this.activeProject.fileHandle = handle;
          await saveProject(toRaw(this.activeProject));
          const file = await handle.getFile();
          this.fileNeeded = false;
          await this._openFileIntoView(file);
        } catch (e) {
          if (e.name !== 'AbortError') console.error(e);
        }
      } else {
        this.$refs.reSelectInput.click();
      }
    },

    async onReSelectFileInput(e) {
      const file = e.target.files[0];
      if (!file) return;
      this.fileNeeded = false;
      await this._openFileIntoView(file);
    },

    // shared: populate IDB or stream-preview, used after re-selecting file
    async _openFileIntoView(file) {
      if (this._isIdbMode(this.activeProject)) {
        await this._populateIdb(file);
        this.filterResults   = await getFirstItems(this.activeProject.id, CONFIG.maxFilterResults);
          this.filterMatchedTotal = this.activeProject?.itemCount || this.filterResults.length;
        this.filterTruncated = false;
        this.page            = 1;
      } else {
        await this._loadFromFile(file, null, CONFIG.previewLimit);
      }
    },

    // ── filter ────────────────────────────────────────────────────────────────

    async applyFilter() {
      if (!this.activeProject) return;
      if (this.fullExporting) this.cancelFullExport();
      // Validate filter tree
      if (this.hasFilter) {
        const ids = [];
        _collectInvalidIds(this.filterRoot, CONFIG.operators, ids);
        if (ids.length) {
          this.filterInvalidIds = new Set(ids);
          this.filterValidationActive = true;
          this.$nextTick(() => {
            const el = document.querySelector('[data-filter-id="' + ids[0] + '"]');
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          });
          return;
        }
      }
      this.filterInvalidIds = new Set();
      this.filterValidationActive = false;
      // Capture the applied filter's top-level OR branches for the per-branch breakdown
      this.appliedBranches = (this.filterRoot.type === 'OR' && this.filterRoot.children.length > 1)
        ? JSON.parse(JSON.stringify(this.filterRoot.children)) : [];
      this._resetBranchState();
      // Persist filter immediately
      const update = toRaw(this.activeProject);
      update.lastFilter = this.hasFilter ? JSON.parse(JSON.stringify(this.filterRoot)) : null;
      saveProject(update).catch(() => {});
      if (this._isIdbMode(this.activeProject)) {
        this.filtering     = true;
        this.filterScanned = 0;
        this.filterResults = [];
        this.page          = 1;
        this.selectedItem  = null;
        this._startTimer();
        try {
          const tree    = this.hasFilter ? JSON.parse(JSON.stringify(this.filterRoot)) : null;
          const filterFn = tree ? (item) => evaluateFilter(item, tree) : () => true;
          this._filterSignal = { cancelled: false };
          const allMatched = await filterItems(
            this.activeProject.id, filterFn, (n) => { this.filterScanned = n; }, this._filterSignal
          );
          this._stopTimer();
          this.filterMatchedTotal = allMatched.length;
          this.filterResults      = allMatched.length > CONFIG.maxFilterResults
            ? allMatched.slice(0, CONFIG.maxFilterResults) : allMatched;
          this.filterTotal     = this.filterResults.length;
          this.filterTruncated = false;
          this.filtering       = false;
        } catch (e) {
          this._stopTimer();
          this.filtering    = false;
          this.projectError = e.message || 'Błąd filtrowania w bazie danych (IndexedDB).';
        }
      } else {
        const file = await this._getFile(this.activeProject);
        if (!file) { this.fileNeeded = true; return; }
        try {
          await this._loadFromFile(
            file,
            this.hasFilter ? this.filterRoot : null,
            this.hasFilter ? null : CONFIG.previewLimit,
          );
        } catch (e) {
          this.projectError = e.message || 'Błąd filtrowania.';
        }
      }
    },

    async clearFilter() {
      this.filterRoot  = _newGroup('AND');
      this.quickSearch = '';
      this.filterInvalidIds = new Set();
      this.filterValidationActive = false;
      this.appliedBranches = [];
      this._resetBranchState();
      if (this.fullExporting) this.cancelFullExport();
      if (!this.activeProject) return;
      if (this._isIdbMode(this.activeProject)) {
        try {
          this.filterResults   = await getFirstItems(this.activeProject.id, CONFIG.maxFilterResults);
          this.filterMatchedTotal = this.activeProject?.itemCount || this.filterResults.length;
          this.filterTruncated = false;
          this.filterTotal     = 0;
          this.page            = 1;
          this.selectedItem    = null;
        } catch (e) {
          this.projectError = e.message || 'Błąd odczytu bazy danych (IndexedDB).';
        }
      } else {
        const file = await this._getFile(this.activeProject);
        if (!file) { this.fileNeeded = true; return; }
        try {
          await this._loadFromFile(file, null, CONFIG.previewLimit);
        } catch (e) {
          this.projectError = e.message || 'Błąd ładowania danych.';
        }
      }
    },

    // ── per-branch breakdown ──────────────────────────────────────────────────
    _resetBranchState() {
      this.showBreakdown          = false;
      this.activeBranchIndex      = null;
      this.branchCounts           = [];
      this.branchCountsComputed   = false;
      this.branchCounting         = false;
      this.branchCountUnavailable = false;
      if (this._branchSignal) { this._branchSignal.cancelled = true; this._branchSignal = null; }
    },

    // Toggle the breakdown row. Case A (in-memory) auto-computes counts on open;
    // case B waits for an explicit "Policz" click inside the row (full re-scan).
    toggleBreakdown() {
      this.showBreakdown = !this.showBreakdown;
      if (this.showBreakdown && !this.resultsTruncated && !this.branchCountsComputed) {
        this.computeBranchCounts();
      }
    },

    _firstCondition(node) {
      if (!node) return null;
      if (node.type === 'condition') return node;
      for (const c of (node.children || [])) { const f = this._firstCondition(c); if (f) return f; }
      return null;
    },

    branchLabel(node) {
      const first = this._firstCondition(node);
      if (!first) return 'grupa';
      const op  = (CONFIG.operators.find(o => o.value === first.operator) || {}).label || first.operator;
      const val = first.multiline ? '(lista)' : (first.value || '');
      const extra = this._countConditions(node) > 1 ? ' …' : '';
      return `${first.field || '?'} ${op} ${val}`.trim() + extra;
    },

    _countConditions(node) {
      if (!node) return 0;
      if (node.type === 'condition') return 1;
      return (node.children || []).reduce((n, c) => n + this._countConditions(c), 0);
    },

    computeBranchCounts() {
      if (!this.appliedBranches.length) return;
      this.branchCountUnavailable = false;
      const branches = this.appliedBranches.map(b => JSON.parse(JSON.stringify(b)));
      if (!this.resultsTruncated) {
        // Case A — client-side over the fully-loaded result set
        this.branchCounts = branches.map(b => {
          let n = 0;
          for (const it of this.filterResults) if (evaluateFilter(it, b)) n++;
          return n;
        });
        this.branchCountsComputed = true;
        return;
      }
      // Case B — full set exceeds the in-memory cap; counts only, no drill-down
      if (this._isIdbMode(this.activeProject)) {
        this.branchCounting = true;
        this._branchSignal = { cancelled: false };
        const fns = branches.map(b => (item) => evaluateFilter(item, b));
        countByFilters(this.activeProject.id, fns, null, this._branchSignal)
          .then(counts => { this.branchCounts = counts; this.branchCountsComputed = true; })
          .catch(e => { this.projectError = e.message || 'Błąd liczenia per filtr.'; })
          .finally(() => { this.branchCounting = false; });
      } else {
        // Stream mode >250k — would require re-streaming a >1 GB file per branch
        this.branchCountUnavailable = true;
        this.branchCountsComputed   = true;
      }
    },

    selectBranch(idx) {
      if (this.resultsTruncated) return;          // drill-down only in case A
      this.activeBranchIndex = this.activeBranchIndex === idx ? null : idx;
      this.page         = 1;
      this.selectedItem = null;
    },

    clearBranch() {
      this.activeBranchIndex = null;
      this.page         = 1;
      this.selectedItem = null;
    },

    // ── saved filters ─────────────────────────────────────────────────────────
    async saveCurrentFilter() {
      if (!this.saveFilterName.trim()) return;
      await saveFilter({
        projectId: this.activeProject.id,
        name:      this.saveFilterName.trim(),
        filter:    JSON.parse(JSON.stringify(this.filterRoot)),
        createdAt: Date.now(),
      });
      this.savedFilters   = await getSavedFilters(this.activeProject.id);
      this.showSaveFilter = false;
      this.saveFilterName = '';
    },

    loadSavedFilter(sf) {
      this.filterRoot = JSON.parse(JSON.stringify(sf.filter));
      _ensureNodeIds(this.filterRoot);
    },

    async deleteSavedFilter(sf) {
      await deleteSavedFilter(sf.id);
      this.savedFilters = await getSavedFilters(this.activeProject.id);
    },

    // ── rule import (from the other system) ───────────────────────────────────
    openRuleImport() {
      this.ruleImportText = '';
      this.showRuleImport = true;
    },

    // Appends converted exclude rules onto the current filter (OR). Does NOT run
    // the filter — that stays on the user's "Zastosuj filtr" click, as before.
    applyRuleImport() {
      const res = this.ruleImportResult;
      if (!res || !res.ok || !res.ruleTrees.length) return;
      const newTrees = JSON.parse(JSON.stringify(res.ruleTrees));  // one tree per imported rule
      // Build the OR-branch list: existing filter (if any) + each imported rule.
      // An existing OR root is unwrapped so we append to its list rather than nest OR-in-OR.
      const units = [];
      if (this.hasFilter) {
        if (this.filterRoot.type === 'OR') units.push(...this.filterRoot.children);
        else units.push(this.filterRoot);
      }
      units.push(...newTrees);
      // Root must be a group: a lone group is used as-is, a lone condition is wrapped,
      // multiple units are OR-ed together.
      let root;
      if (units.length === 1) root = units[0].type === 'condition' ? { type: 'AND', children: [units[0]] } : units[0];
      else root = { type: 'OR', children: units };
      this.filterRoot = root;
      _ensureNodeIds(this.filterRoot);
      this.filterInvalidIds = new Set();
      this.filterValidationActive = false;
      this.showRuleImport = false;
    },

    // ── table ─────────────────────────────────────────────────────────────────
    toggleSort(field) {
      if (this.sortField === field) this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
      else { this.sortField = field; this.sortDir = 'asc'; }
      this.page = 1;
    },

    toggleField(field) {
      const idx = this.visibleFields.indexOf(field);
      if (idx === -1)                         this.visibleFields.push(field);
      else if (this.visibleFields.length > 1) this.visibleFields.splice(idx, 1);
      // Persist immediately so a page refresh keeps the selection
      if (this.activeProject) {
        const update = toRaw(this.activeProject);
        update.visibleFields = [...this.visibleFields];
        saveProject(update).catch(() => {});
      }
    },

    // ── detail ────────────────────────────────────────────────────────────────
    selectItem(item) {
      this.selectedItem = this.selectedItem === item ? null : item;
    },

    async copyField(key, value) {
      const text = Array.isArray(value) ? value.join('\n') : String(value ?? '');
      try {
        await navigator.clipboard.writeText(text);
        this.copiedKey = key;
        setTimeout(() => { if (this.copiedKey === key) this.copiedKey = null; }, 1500);
      } catch (_) {}
    },

    isImageUrl(v) {
      return typeof v === 'string' && v.startsWith('http') &&
        /\.(jpe?g|png|gif|webp|svg)(\?|$)/i.test(v);
    },

    isUrl(v) {
      return typeof v === 'string' && /^https?:\/\//.test(v);
    },

    isLinkField(f) {
      const fl = f.toLowerCase().replace(/^[a-z]:/, '');
      return fl === 'link' || fl.endsWith('_link') || fl.endsWith('_url') || fl === 'url';
    },

    displayVal(v) {
      if (Array.isArray(v)) return v.join(' | ');
      return String(v ?? '');
    },

    // ── delete project ────────────────────────────────────────────────────────
    async doDeleteProject() {
      if (!this.confirmDelete) return;
      try {
        const deletedId = this.confirmDelete.id;
        await deleteProject(deletedId);
        if (this._lastIdbProjectId === deletedId) this._lastIdbProjectId = null;
        this.confirmDelete  = null;
        this.activeProject  = null;  // prevent goToList from re-saving deleted project
        await this.goToList();
      } catch (e) {
        alert('Błąd usuwania projektu: ' + e.message);
      }
    },

    async doDeleteAll() {
      try {
        await deleteAllData();
        this._lastIdbProjectId = null;
        this.confirmDeleteAll  = false;
        this.projects          = [];
      } catch (e) {
        alert('Błąd usuwania danych: ' + e.message);
      }
    },

    // ── export ────────────────────────────────────────────────────────────────
    async doExportXml() {
      if (this.filterMatchedTotal > this.filterResults.length) {
        await this._fullExport('xml');
      } else {
        const schema = this._getSchema(this.activeProject);
        exportXml(this.branchResults, schema?.itemTags?.[0] || 'item', schema?.nestedSeparator || '.');
      }
    },
    async doExportXlsx() {
      if (this.filterMatchedTotal > this.filterResults.length) {
        await this._fullExport('xlsx');
      } else {
        exportXlsx(this.branchResults, this.visibleFields);
      }
    },
    doExportItemXml() {
      if (!this.selectedItem) return;
      const schema = this._getSchema(this.activeProject);
      exportXml([this.selectedItem], schema?.itemTags?.[0] || 'item', schema?.nestedSeparator || '.');
    },

    async _fullExport(format) {
      this.fullExporting = true;
      this.fullExportProgress = 0;
      try {
        const items = this._isIdbMode(this.activeProject)
          ? await this._fullExportIdb()
          : await this._fullExportStream();
        if (!items) return;
        const schema = this._getSchema(this.activeProject);
        if (format === 'xml') {
          exportXml(items, schema?.itemTags?.[0] || 'item', schema?.nestedSeparator || '.');
        } else {
          exportXlsx(items, this.visibleFields);
        }
      } catch (e) {
        this.projectError = e.message || 'Błąd eksportu.';
      } finally {
        this.fullExporting = false;
      }
    },

    async _fullExportIdb() {
      const tree = this.hasFilter ? JSON.parse(JSON.stringify(this.filterRoot)) : null;
      const filterFn = tree ? (item) => evaluateFilter(item, tree) : () => true;
      this._filterSignal = { cancelled: false };
      const items = await filterItems(
        this.activeProject.id, filterFn,
        (n) => { this.fullExportProgress = n; },
        this._filterSignal
      );
      if (this._filterSignal.cancelled) return null;
      this._filterSignal = null;
      return items;
    },

    async _fullExportStream() {
      const file = await this._getFile(this.activeProject);
      if (!file) { this.fileNeeded = true; return null; }
      const schema = JSON.parse(JSON.stringify(this._getSchema(this.activeProject)));
      const filter = this.hasFilter ? JSON.parse(JSON.stringify(this.filterRoot)) : null;
      return new Promise((resolve, reject) => {
        const items = [];
        const worker = this._createWorker();
        worker.onerror = (e) => {
          this._worker = null;
          URL.revokeObjectURL(this._workerUrl); this._workerUrl = null;
          reject(new Error(e.message || 'Błąd workera'));
        };
        worker.onmessage = ({ data }) => {
          if (data.type === 'progress') {
            this.fullExportProgress = data.count;
          } else if (data.type === 'batch') {
            items.push(...data.items);
          } else if (data.type === 'done') {
            this._worker = null;
            URL.revokeObjectURL(this._workerUrl); this._workerUrl = null;
            resolve(items);
          } else if (data.type === 'error') {
            this._worker = null;
            URL.revokeObjectURL(this._workerUrl); this._workerUrl = null;
            reject(new Error(data.message));
          }
        };
        this._postWorker(worker, {
          file, schema,
          config: { chunkSize: CONFIG.chunkSize, batchSize: CONFIG.workerBatchSize },
          filter, limit: null, resultLimit: null,
        });
      });
    },

    cancelFullExport() {
      if (this._worker) { this._worker.terminate(); this._worker = null; }
      if (this._workerUrl) { URL.revokeObjectURL(this._workerUrl); this._workerUrl = null; }
      if (this._filterSignal) { this._filterSignal.cancelled = true; this._filterSignal = null; }
      this.fullExporting = false;
    },

    // ── IDB / stream mode ─────────────────────────────────────────────────────
    _isIdbMode(project) {
      return (project || this.activeProject).fileSize < CONFIG.idbSizeLimit;
    },

    // Load entire file into per-project IDB (called on project open in IDB mode)
    async _populateIdb(file) {
      this.filtering     = true;
      this.filterScanned = 0;
      this.filterTotal   = 0;
      this._startTimer();
      await clearProjectItems(this.activeProject.id);
      const projectId = this.activeProject.id;
      const schema    = JSON.parse(JSON.stringify(this._getSchema(this.activeProject)));
      return new Promise((resolve, reject) => {
        const worker = this._createWorker();
        const inserts = [];   // track all in-flight insertItems promises
        worker.onerror = (e) => {
          this.filtering = false; this._worker = null;
          reject(new Error(e.message || 'Błąd workera'));
        };
        worker.onmessage = async ({ data }) => {
          if (data.type === 'progress') {
            this.filterScanned = data.count;
          } else if (data.type === 'batch') {
            inserts.push(insertItems(projectId, data.items));  // don't await — track instead
          } else if (data.type === 'done') {
            try { await Promise.all(inserts); } catch (e) {
              this._stopTimer(); this.filtering = false; this._worker = null;
              URL.revokeObjectURL(this._workerUrl); this._workerUrl = null;
              reject(e); return;
            }
            this._stopTimer();
            this.filtering   = false;
            this.filterTotal = data.scanned;
            this._worker     = null;
            URL.revokeObjectURL(this._workerUrl); this._workerUrl = null;
            resolve(data);
          } else if (data.type === 'error') {
            this._stopTimer();
            this.filtering = false; this._worker = null;
            URL.revokeObjectURL(this._workerUrl); this._workerUrl = null;
            reject(new Error(data.message));
          }
        };
        this._postWorker(worker, {
          file,
          schema,
          config: { chunkSize: CONFIG.chunkSize, batchSize: CONFIG.workerBatchSize },
          filter: null, limit: null,
        });
      });
    },

    // ── timer ─────────────────────────────────────────────────────────────────
    _startTimer() {
      this.filterStartTime = Date.now();
      this.filterElapsed   = 0;
      if (this._filterTimer) clearInterval(this._filterTimer);
      this._filterTimer = setInterval(() => {
        this.filterElapsed = Date.now() - this.filterStartTime;
      }, 200);
    },
    _stopTimer() {
      if (this._filterTimer) { clearInterval(this._filterTimer); this._filterTimer = null; }
      this.filterElapsed = Date.now() - this.filterStartTime;
    },
    _stopImportTimer() {
      if (this._importTimer) { clearInterval(this._importTimer); this._importTimer = null; }
      this.importElapsed = Date.now() - this._importStartTime;
    },
    _startIndexingTimer() {
      this.indexingElapsed    = 0;
      this._indexingStartTime = Date.now();
      if (this._indexingTimer) clearInterval(this._indexingTimer);
      this._indexingTimer = setInterval(() => { this.indexingElapsed = Date.now() - this._indexingStartTime; }, 200);
    },
    _stopIndexingTimer() {
      if (this._indexingTimer) { clearInterval(this._indexingTimer); this._indexingTimer = null; }
      this.indexingElapsed = Date.now() - this._indexingStartTime;
    },

    // ── helpers ───────────────────────────────────────────────────────────────
    fmtSize(b) {
      if (b < 1024)           return b + ' B';
      if (b < 1048576)        return (b / 1024).toFixed(1) + ' KB';
      if (b < 1073741824)     return (b / 1048576).toFixed(1) + ' MB';
      return (b / 1073741824).toFixed(2) + ' GB';
    },
    fmtDate(ts) {
      return ts ? new Date(ts).toLocaleString('pl-PL') : '—';
    },
    fmtElapsed(ms) {
      if (!ms) return '';
      if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
      const m = Math.floor(ms / 60000);
      const s = Math.round((ms % 60000) / 1000);
      return m + 'm ' + s + 's';
    },
  },

  async mounted() {
    await initMetaDB();
    this.projects = await getProjects();
    // Restore project from hash (e.g. #project-a7f3b2)
    const m = location.hash.match(/^#project-(.+)$/);
    if (m) {
      const project = this.projects.find(p => String(p.id) === m[1]);
      if (project) await this.openProject(project);
    }
  },
});

app.component('FilterGroup', FilterGroup);
app.mount('#app');
