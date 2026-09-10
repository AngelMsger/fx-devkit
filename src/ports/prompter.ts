// Asking a person something. Every method fails with INPUT_REQUIRED instead of hanging
// when there is no person to ask, so a use case can ask freely and an agent still gets a
// structured answer.

export interface ConfirmOptions {
  readonly commands?: readonly string[];
  readonly defaultYes?: boolean;
}

export interface Prompter {
  confirm(question: string, options?: ConfirmOptions): Promise<boolean>;
  ask(question: string): Promise<string>;
  pause(message: string): Promise<void>;
}
