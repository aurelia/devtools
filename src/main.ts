import Aurelia, { DI, IPlatform, PLATFORM, Registration } from 'aurelia';
import { StandardConfiguration } from '@aurelia/runtime-html';

import './styles.css';
import { App } from './app';


const aurelia = new Aurelia(
  DI.createContainer().register(
    Registration.instance(IPlatform, PLATFORM),
  StandardConfiguration
  )
).app(App);
aurelia.start();
