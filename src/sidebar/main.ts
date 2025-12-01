import Aurelia, { DI, IPlatform, PLATFORM, Registration } from 'aurelia';
import { StandardConfiguration } from '@aurelia/runtime-html';

import './sidebar-app.css';
import { SidebarApp } from './sidebar-app';

const aurelia = new Aurelia(
  DI.createContainer().register(
    Registration.instance(IPlatform, PLATFORM),
    StandardConfiguration
  )
).app(SidebarApp);

aurelia.start();
