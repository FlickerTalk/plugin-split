import { initialize } from "@ionic/core/components";
import { defineCustomElement as button } from "@ionic/core/components/ion-button.js";
import { defineCustomElement as buttons } from "@ionic/core/components/ion-buttons.js";
import { defineCustomElement as content } from "@ionic/core/components/ion-content.js";
import { defineCustomElement as header } from "@ionic/core/components/ion-header.js";
import { defineCustomElement as title } from "@ionic/core/components/ion-title.js";
import { defineCustomElement as toolbar } from "@ionic/core/components/ion-toolbar.js";

initialize();
for (const define of [button, buttons, content, header, title, toolbar]) define();
