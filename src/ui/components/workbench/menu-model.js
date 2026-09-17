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
      id: 'insert',
      label: translate('parsinegar.menu.insert'),
      items: [
        { id: 'insert-heading', label: translate('parsinegar.insert.heading'), action: 'insert-heading', disabled: false },
        { id: 'insert-bold', label: translate('parsinegar.insert.bold'), action: 'insert-bold', disabled: false },
        { id: 'insert-italic', label: translate('parsinegar.insert.italic'), action: 'insert-italic', disabled: false },
        { id: 'insert-strikethrough', label: translate('parsinegar.insert.strikethrough'), action: 'insert-strikethrough', disabled: false },
        { id: 'insert-quote', label: translate('parsinegar.insert.quote'), action: 'insert-quote', disabled: false },
        { id: 'insert-link', label: translate('parsinegar.insert.link'), action: 'insert-link', disabled: false },
        { id: 'insert-code', label: translate('parsinegar.insert.code'), action: 'insert-code', disabled: false },
        { id: 'insert-unordered-list', label: translate('parsinegar.insert.unordered-list'), action: 'insert-unordered-list', disabled: false },
        { id: 'insert-ordered-list', label: translate('parsinegar.insert.ordered-list'), action: 'insert-ordered-list', disabled: false },
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
