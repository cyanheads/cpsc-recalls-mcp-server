/** The canonical CPSC remedy classifications and their description on tool outputs. */

/** The selectable remedy classifications published by CPSC. */
export const REMEDY_OPTIONS = [
  'Refund',
  'Repair',
  'Replace',
  'New Instructions',
  'Dispose',
  'Label',
  'No Remedy Available',
  'Inspect',
] as const;

/** Output values preserve the source, which sometimes omits or misclassifies an option. */
export const REMEDY_OPTIONS_DESCRIPTION = `CPSC remedy types: ${REMEDY_OPTIONS.join(', ')}. CPSC may leave the list empty or report an unclassified value.`;
