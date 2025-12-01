import { bindable } from 'aurelia';

export class Counter {
  @bindable value = 0;
  @bindable label = 'Count';

  increment() {
    this.value++;
  }

  decrement() {
    this.value--;
  }
}
