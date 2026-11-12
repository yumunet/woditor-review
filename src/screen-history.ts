export interface Screen<T> {
  base: string;
  layers: string[];
  value: T;
  preservePrevious?: boolean;
}
interface Entry<T> extends Screen<T> {
  id: string;
}
const same = <T>(a: Screen<T>, b: Screen<T>) =>
  a.base === b.base && a.layers.join('\0') === b.layers.join('\0');

// Keep large view data and callbacks in memory; only an opaque ID enters history.
export class ScreenHistory<T> {
  private entries: Entry<T>[];
  private index = 0;
  private pending?: { id: string; screen: Screen<T> };
  constructor(
    initial: Screen<T>,
    private restore: (value: T) => void,
  ) {
    this.entries = [this.entry(initial)];
    this.replace();
    window.addEventListener('popstate', (event) => {
      const index = this.entries.findIndex((e) => e.id === event.state?.woditorScreen);
      if (index < 0) {
        this.pending = undefined;
        this.index = 0;
        this.entries = [this.entry(initial)];
        this.replace();
        this.restore(initial.value);
        return;
      }
      this.index = index;
      const pending = this.pending;
      this.pending = undefined;
      if (pending?.id === this.entries[index].id) this.sync(pending.screen);
      else this.restore(this.entries[index].value);
    });
  }
  private entry(screen: Screen<T>): Entry<T> {
    return { ...screen, id: crypto.randomUUID() };
  }
  private replace() {
    history.replaceState({ woditorScreen: this.entries[this.index].id }, '');
  }
  sync(screen: Screen<T>) {
    if (this.pending) {
      this.pending.screen = screen;
      return;
    }
    const current = this.entries[this.index];
    if (same(current, screen) && !screen.preservePrevious) {
      current.value = screen.value;
      return;
    }
    let target = -1;
    // Closing a panel (or returning home) consumes its history entries. A new
    // file first closes any overlay, so Back never reopens a stale confirmation.
    for (let i = screen.preservePrevious ? -1 : this.index - 1; i >= 0; i--) {
      const entry = this.entries[i];
      if (
        same(entry, screen) ||
        (current.layers.length &&
          entry.base === current.base &&
          !entry.layers.length &&
          screen.base !== current.base)
      ) {
        target = i;
        break;
      }
    }
    if (target >= 0) {
      this.pending = { id: this.entries[target].id, screen };
      history.go(target - this.index);
      return;
    }
    const entry = this.entry(screen);
    if (current.base === screen.base && current.layers[0] === 'menu') {
      this.entries[this.index] = entry;
      this.replace();
    } else {
      this.entries.splice(this.index + 1);
      this.entries.push(entry);
      this.index++;
      history.pushState({ woditorScreen: entry.id }, '');
    }
  }
}
