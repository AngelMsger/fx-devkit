// What fx is doing right now, told to whoever watches it work. Nothing said here is a
// result or a record: a terminal shows it while it lasts, and a program reading the
// streams sees none of it.

export type Release = () => void;

// How far counted work has come.
export interface Count {
  readonly phase?: string | undefined;
  readonly total: number;
  readonly completed: number;
  // The units under way.
  readonly active: readonly string[];
}

// One external call fx waits on.
export interface Wait {
  readonly label: string;
  // The call can still write to the terminal on its own, the way ssh asks about a host
  // key or a passphrase, so nothing may be redrawn under it.
  readonly mayAsk: boolean;
}

export interface Activity {
  // An external call is under way until the returned function is called.
  waiting(wait: Wait): Release;
  // Someone else has the terminal until the returned function is called: a question put
  // to the person, or a child process that owns it.
  handover(): Release;
  // Where the counted work named `id` stands; `undefined` once it is over.
  counted(id: string, count: Count | undefined): void;
}
