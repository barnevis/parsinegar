// Sync orchestration for the workbench page.
//
// Owns the sync state machine (busy, conflicts, dirty flag, configure
// attempt, commit-message prompt) and every service round: configure,
// remove, run, conflict resolve, dirty recheck. Reads the preferences
// snapshot lazily through the injected accessors and reports upward through
// plain callbacks — the page stays the only DOM owner (rail dot, side panel
// snapshot, modal) and keeps its callers→service envelopes untouched.
// Missing service degrades everything to a no-op; editing never breaks.
export function createSyncController({
  getSyncer = () => null,
  getSettings = () => null,
  formatDate = (value) => String(value),
  translate = (key) => key,
  isConnected = () => true,
  flushDraft = async () => {},
  onSettled = async () => {},
  onChromeChanged = () => {},
  onPanelChanged = () => {},
  onModalChanged = () => {},
} = {}) {
  let busy = false;
  let conflicts = [];
  let status = null;
  let messageOpen = false;
  let attempt = null;
  let dirty = false;
  let dirtyWrite = null;

  // Path identity: only document lives on the remote; folders become the
  // directory chain of each document (created on pull), never synced data.
  const SCOPE = {
    collections: [
      {
        collection: 'documents',
        serializer: 'markdown',
        titleField: 'title',
        folders: { collection: 'folders', nameField: 'name' },
      },
    ],
  };

  const storedIgnore = () => {
    const stored = getSettings()?.getState().settings?.syncIgnore;
    return Array.isArray(stored) ? stored.filter((pattern) => typeof pattern === 'string') : [];
  };

  const scope = () => ({
    collections: SCOPE.collections.map((entry) => entry.collection === 'documents'
      ? { ...entry, ignore: storedIgnore() }
      : entry),
  });

  const autoCommit = () => getSettings()?.getState().settings?.syncCommitAuto !== false;

  const notifyChrome = () => {
    onChromeChanged({ dot: dotState(), hint: hintText() });
  };

  const notifyPanel = () => {
    onPanelChanged({ snapshot: status });
  };

  const notifyModal = () => {
    onModalChanged();
  };

  /**
   * Rebuilds the status snapshot from the service and reports it to the
   * page (rail dot, side panel, modal). Service failures degrade to no
   * snapshot; the view keeps its last truth.
   * @returns {Promise<void>}
   */
  async function refresh() {
    let snapshot = null;
    try {
      const syncStatus = await getSyncer()?.getStatus();
      if (syncStatus) {
        const lastSyncText = typeof syncStatus.lastSyncAt === 'number' ? formatDate(syncStatus.lastSyncAt) : null;
        const errorText = syncStatus.lastError?.message ?? null;
        snapshot = {
          configured: syncStatus.configured === true,
          kind: syncStatus.kind ?? attempt?.kind ?? null,
          repo: syncStatus.repo ?? attempt?.repo ?? null,
          branch: syncStatus.branch ?? attempt?.branch ?? null,
          baseUrl: syncStatus.baseUrl ?? attempt?.baseUrl ?? null,
          lastSyncText,
          errorText,
          busy,
          ignoreText: storedIgnore().join('\n'),
          autoCommit: autoCommit(),
          clean: syncStatus.configured === true
            && !busy
            && conflicts.length === 0
            && !dirty
            && !errorText
            && typeof lastSyncText === 'string',
        };
      }
    } catch {
      snapshot = null;
    }
    status = snapshot;
    if (!isConnected()) {
      return;
    }
    notifyChrome();
    notifyPanel();
    notifyModal();
  }

  /**
   * Rechecks local dirtiness against the sync snapshot (local reads only,
   * never network) and moves the rail dot when it flips. Runs serialize
   * like the theme queue so rapid saves converge instead of racing.
   * @returns {Promise<void>}
   */
  async function updateDirty() {
    const run = (dirtyWrite ?? Promise.resolve()).then(async () => {
      let next = false;
      try {
        const syncer = getSyncer();
        if (syncer && typeof syncer.hasPendingChanges === 'function' && isConnected()) {
          const checked = await syncer.hasPendingChanges({ scope: scope() });
          next = checked?.pending === true;
        }
      } catch {
        // A failed check never flips the dot; the next trigger retries.
        return;
      }
      if (!isConnected() || dirty === next) {
        return;
      }
      dirty = next;
      notifyChrome();
      // The settings view gates «همگام‌سازی» on cleanliness too: refresh the
      // stored snapshot's flag without a service round-trip.
      if (status) {
        status = {
          ...status,
          clean: status.configured === true
            && !busy
            && conflicts.length === 0
            && !next
            && !status.errorText
            && typeof status.lastSyncText === 'string',
        };
        notifyPanel();
      }
    });
    dirtyWrite = run.catch(() => {});
    return run;
  }

  /**
   * Configures the sync backend from the settings form. Validation failures
   * surface through the next status refresh (the service records run
   * errors; field emptiness is already guarded by reportValidity).
   * @param {object} detail `{ kind, repo, branch, token, baseUrl }`.
   * @returns {Promise<void>}
   */
  async function configureBackend(detail) {
    const syncer = getSyncer();
    if (!syncer) {
      return;
    }
    const kind = detail?.kind === 'gitlab' ? 'gitlab' : 'git';
    const repo = typeof detail?.repo === 'string' ? detail.repo.trim() : '';
    const branch = typeof detail?.branch === 'string' && detail.branch.trim().length > 0
      ? detail.branch.trim()
      : 'main';
    const token = typeof detail?.token === 'string' ? detail.token : '';
    const baseUrl = typeof detail?.baseUrl === 'string' ? detail.baseUrl.trim() : '';
    if (repo.length === 0 || token.length === 0) {
      return;
    }
    // The attempt survives a failed configure so the form repopulates
    // (host, repo and branch only — the token is never echoed back).
    attempt = { repo, branch, kind, baseUrl };
    busy = true;
    await refresh();
    const params = kind === 'gitlab'
      ? { repo, branch, token, baseUrl: baseUrl.length > 0 ? baseUrl : undefined }
      : { repo, branch, token };
    try {
      await syncer.configureBackend({ kind, params });
      attempt = null;
    } catch {
      // Failure lands in status via getStatus on refresh below.
    } finally {
      busy = false;
      await refresh();
    }
  }

  /**
   * Removes the sync backend and closes any pending conflict view.
   * @returns {Promise<void>}
   */
  async function removeBackend() {
    try {
      await getSyncer()?.removeBackend();
    } catch {
      // Best effort; status refresh reports the truth.
    }
    conflicts = [];
    dirty = false;
    await refresh();
  }

  /**
   * Persists the ignore patterns from the sync view (no editor remount:
   * only dirtiness and the panel refresh), then rechecks.
   * @param {unknown} patterns Raw pattern list from the event detail.
   * @returns {Promise<void>}
   */
  async function saveIgnore(patterns) {
    const cleaned = Array.isArray(patterns) ? patterns.filter((pattern) => typeof pattern === 'string') : [];
    const outcome = await getSettings()?.saveSyncIgnore(cleaned);
    if (!isConnected() || outcome !== 'applied') {
      return;
    }
    await updateDirty();
    await refresh();
  }

  /**
   * Persists the commit-message mode (no editor remount: the panel alone
   * refreshes the checkbox from the snapshot).
   * @param {unknown} enabled Toggle state from the event detail.
   * @returns {Promise<void>}
   */
  async function saveCommitAuto(enabled) {
    await getSettings()?.saveSyncCommitAuto(enabled === true);
    await refresh();
  }

  /**
   * Entry of the sync button: a straight run with automatic messages, or
   * the commit-message prompt when the custom-message mode is on. Re-entry
   * while busy is refused (the button is disabled too, but events can lag).
   * @returns {void}
   */
  function beginNow() {
    if (!getSyncer() || busy) {
      return;
    }
    if (autoCommit()) {
      void runNow();
      return;
    }
    messageOpen = true;
    notifyModal();
  }

  /**
   * Submits the typed commit message and starts the sync with it; an empty
   * message cannot arrive (the confirm button stays disabled), the trim
   * here is just belt-and-braces against whitespace-only input.
   * @param {unknown} message Typed commit message.
   * @returns {void}
   */
  function sendMessage(message) {
    messageOpen = false;
    const text = typeof message === 'string' ? message.trim() : '';
    void runNow(text.length > 0 ? text : null);
  }

  /**
   * Runs one manual sync: flushes the pending draft first so pulled content
   * can never clobber unsaved keystrokes (the flush stamps updatedAt, which
   * turns a would-be overwrite into a conflict instead), then settles the
   * page (library reload) and rechecks dirtiness and status. A custom
   * message (custom-message mode) becomes the commit text of every remote
   * write and delete this run performs.
   * @param {string|null} [message] Typed commit message, or null for the
   *   automatic per-path messages.
   * @returns {Promise<void>}
   */
  async function runNow(message = null) {
    const syncer = getSyncer();
    if (!syncer) {
      return;
    }
    await flushDraft();
    if (!isConnected()) {
      return;
    }
    busy = true;
    messageOpen = false;
    await refresh();
    const text = typeof message === 'string' ? message.trim() : '';
    const input = text.length > 0
      ? { scope: scope(), message: text }
      : { scope: scope() };
    let report = null;
    try {
      report = await syncer.syncNow(input);
    } catch {
      busy = false;
      await refresh();
      return;
    }
    busy = false;
    conflicts = Array.isArray(report?.conflicts) ? report.conflicts : [];
    await onSettled();
    await updateDirty();
    await refresh();
  }

  /**
   * Applies one conflict choice, then advances the dialog or closes it.
   * A stale choice (remote moved on) drops the queue view and refreshes.
   * @param {object} detail `{ collection, id, choice }`.
   * @returns {Promise<void>}
   */
  async function resolveConflict(detail) {
    const syncer = getSyncer();
    if (!syncer) {
      return;
    }
    const { collection, id, choice } = detail ?? {};
    try {
      await syncer.resolveConflict({ collection, id, choice });
      conflicts = conflicts.filter(
        (item) => !(item.collection === collection && item.id === id),
      );
    } catch {
      conflicts = [];
    }
    await onSettled();
    await updateDirty();
    await refresh();
  }

  /**
   * Drops the pending conflict queue («بعداً» choice): the dialog closes
   * and the next refresh rebuilds the truth.
   * @returns {Promise<void>}
   */
  async function later() {
    conflicts = [];
    await refresh();
  }

  /**
   * Derives the rail sync dot from the latest state: blinking orange while
   * an operation runs, red on error or pending conflict, steady orange
   * while local news awaits sending (or no clean sync yet), green once a
   * clean sync completed.
   * @returns {string} 'ok', 'stale', 'busy' or 'bad'.
   */
  function dotState() {
    if (busy) {
      return 'busy';
    }
    if (conflicts.length > 0) {
      return 'bad';
    }
    if (!status || status.configured !== true) {
      return 'stale';
    }
    if (status.errorText) {
      return 'bad';
    }
    if (dirty) {
      return 'stale';
    }
    return status.lastSyncText ? 'ok' : 'stale';
  }

  /**
   * Builds the sync button tooltip: names the unsent changes only while the
   * dot shows the steady-orange dirty state, otherwise nothing.
   * @returns {string|null} Hint text or null.
   */
  function hintText() {
    if (busy || !dirty || conflicts.length > 0) {
      return null;
    }
    if (!status || status.configured !== true || status.errorText) {
      return null;
    }
    return translate('parsinegar.sync.unsent-changes');
  }

  /**
   * Builds the pending conflict modal snapshot, if any.
   * @returns {object|null} `{ kind: 'sync-conflict', ... }` or null.
   */
  function conflictModal() {
    const head = conflicts[0];
    if (!head) {
      return null;
    }
    return {
      kind: 'sync-conflict',
      conflict: {
        collection: head.collection,
        id: head.id,
        title: head.title ?? head.id,
        local: head.local,
        remote: head.remote,
      },
    };
  }

  return {
    refresh,
    updateDirty,
    configureBackend,
    removeBackend,
    saveIgnore,
    saveCommitAuto,
    beginNow,
    sendMessage,
    resolveConflict,
    later,
    dot: dotState,
    hint: hintText,
    snapshot: () => status,
    conflictModal,
    messageModal: () => (messageOpen ? { kind: 'sync-message' } : null),
    messageOpen: () => messageOpen,
    dismissMessage: () => {
      messageOpen = false;
    },
  };
}
