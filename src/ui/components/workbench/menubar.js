// Menu bar model for the workbench: pure data, no rendering.
//
// Builds the menu structure from the translation function and the current
// capabilities; actions are string ids the owning page maps to behavior, so
// this module stays free of services and DOM.

/**
 * Builds the menu bar model.
 * @param {object} options Model options.
 * @param {Function} options.t Translation function.
 * @param {boolean} options.hasDocument Whether a document is open.
 * @returns {Array<object>} Menus with `{ id, label, items: [{ id, label, action, disabled }] }`.
 */
export function buildMenuModel({ t, hasDocument }) {
  const translate = typeof t === 'function' ? t : (key) => key;
  return [
    {
      id: 'file',
      label: translate('parsinegar.menu.file'),
      items: [
        { id: 'new-document', label: translate('parsinegar.documents.new'), action: 'new-document', disabled: false },
        { id: 'delete-document', label: translate('parsinegar.documents.delete'), action: 'delete-document', disabled: !hasDocument },
      ],
    },
    {
      id: 'edit',
      label: translate('parsinegar.menu.edit'),
      items: [
        { id: 'undo', label: translate('parsinegar.action.undo'), action: 'undo', disabled: false },
        { id: 'redo', label: translate('parsinegar.action.redo'), action: 'redo', disabled: false },
      ],
    },
    {
      id: 'view',
      label: translate('parsinegar.menu.view'),
      items: [
        { id: 'toggle-side', label: translate('parsinegar.view.side'), action: 'toggle-side', disabled: false },
        { id: 'toggle-status', label: translate('parsinegar.view.status'), action: 'toggle-status', disabled: false },
      ],
    },
  ];
}
