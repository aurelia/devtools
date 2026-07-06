import { applyDevtoolsOptOutState } from '../shared/devtools-optout';
import { install } from './install';

(function installGlobalHook() {
  const w = window as any;

  if (applyDevtoolsOptOutState(w)) {
    return;
  }

  if (w.__AURELIA_DEVTOOLS_GLOBAL_HOOK__ && w.__AURELIA_DEVTOOLS_GLOBAL_HOOK__.__au_devtools_installed__) {
    return;
  }

  const installedData = install(w.__AURELIA_DEVTOOLS_DEBUG_LOOKUP__);
  w.__AURELIA_DEVTOOLS_GLOBAL_HOOK__ = installedData.hooks;
  w.__AURELIA_DEVTOOLS_GLOBAL_HOOK__.__au_devtools_installed__ = true;
  w.__AURELIA_DEVTOOLS_DEBUG_LOOKUP__ = installedData.debugValueLookup;
})();
