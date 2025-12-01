import Aurelia from 'aurelia';
import { App } from './app';
import { Counter } from './components/counter';
import { UserCard } from './components/user-card';

new Aurelia()
  .register(Counter, UserCard)
  .app(App)
  .start();
