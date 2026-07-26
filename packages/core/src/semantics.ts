export type SemanticRole =
  | "application"
  | "navigation"
  | "menu"
  | "menuitem"
  | "tab"
  | "tabpanel"
  | "form"
  | "textbox"
  | "checkbox"
  | "radio"
  | "switch"
  | "listbox"
  | "option"
  | "table"
  | "row"
  | "cell"
  | "dialog"
  | "alert"
  | "status"
  | "progressbar"
  | "tree"
  | "treeitem"
  | "button"
  | "heading"
  | "text";

export interface SemanticMetadata {
  readonly id?: string;
  readonly testId?: string;
  readonly role?: SemanticRole;
  readonly label?: string;
  readonly description?: string;
  readonly disabled?: boolean;
  readonly readOnly?: boolean;
  readonly selected?: boolean;
  readonly checked?: boolean;
  readonly expanded?: boolean;
  readonly valueText?: string;
}

export interface TerminalBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
