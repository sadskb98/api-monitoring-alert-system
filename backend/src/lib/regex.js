/** Pure: escape a string so it matches literally inside a RegExp / MongoDB $regex. */
export const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
