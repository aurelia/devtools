import Aurelia from 'aurelia';

import './sidebar-app.css';
import { PropertyList } from './components/property-list';
import { SidebarApp } from './sidebar-app';

new Aurelia().register(PropertyList).app(SidebarApp).start();
