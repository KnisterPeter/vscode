/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/panelpart';
import { TPromise } from 'vs/base/common/winjs.base';
import { IAction, Action } from 'vs/base/common/actions';
import Event from 'vs/base/common/event';
import { Builder, Dimension } from 'vs/base/browser/builder';
import { Registry } from 'vs/platform/registry/common/platform';
import { ActionsOrientation } from 'vs/base/browser/ui/actionbar/actionbar';
import { Scope } from 'vs/workbench/browser/actions';
import { IPanel } from 'vs/workbench/common/panel';
import { CompositePart, ICompositeTitleLabel } from 'vs/workbench/browser/parts/compositePart';
import { Panel, PanelRegistry, Extensions as PanelExtensions } from 'vs/workbench/browser/panel';
import { IPanelService, IPanelIdentifier } from 'vs/workbench/services/panel/common/panelService';
import { IPartService, Parts } from 'vs/workbench/services/part/common/partService';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IMessageService } from 'vs/platform/message/common/message';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ClosePanelAction, ToggleMaximizedPanelAction, PanelActivityAction, OpenPanelAction } from 'vs/workbench/browser/parts/panel/panelActions';
import { IThemeService, registerThemingParticipant, ITheme, ICssStyleCollector } from 'vs/platform/theme/common/themeService';
import { PANEL_BACKGROUND, PANEL_BORDER, PANEL_ACTIVE_TITLE_FOREGROUND, PANEL_INACTIVE_TITLE_FOREGROUND, PANEL_ACTIVE_TITLE_BORDER } from 'vs/workbench/common/theme';
import { activeContrastBorder, focusBorder, contrastBorder, editorBackground } from 'vs/platform/theme/common/colorRegistry';
import { CompositeBar } from 'vs/workbench/browser/parts/compositebar/compositeBar';
import { ToggleCompositePinnedAction } from 'vs/workbench/browser/parts/compositebar/compositeBarActions';
import { StandardMouseEvent } from 'vs/base/browser/mouseEvent';
import { dispose } from 'vs/base/common/lifecycle';

export class PanelPart extends CompositePart<Panel> implements IPanelService {

	public static activePanelSettingsKey = 'workbench.panelpart.activepanelid';
	private static readonly PINNED_PANELS = 'workbench.panel.pinnedPanels';

	public _serviceBrand: any;

	private blockOpeningPanel: boolean;
	private compositeBar: CompositeBar;

	constructor(
		id: string,
		@IMessageService messageService: IMessageService,
		@IStorageService storageService: IStorageService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IPartService partService: IPartService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IThemeService themeService: IThemeService,
	) {
		super(
			messageService,
			storageService,
			telemetryService,
			contextMenuService,
			partService,
			keybindingService,
			instantiationService,
			themeService,
			Registry.as<PanelRegistry>(PanelExtensions.Panels),
			PanelPart.activePanelSettingsKey,
			Registry.as<PanelRegistry>(PanelExtensions.Panels).getDefaultPanelId(),
			'panel',
			'panel',
			Scope.PANEL,
			null,
			id,
			{ hasTitle: true }
		);

		this.compositeBar = this.instantiationService.createInstance(CompositeBar, {
			icon: false,
			storageId: PanelPart.PINNED_PANELS,
			orientation: ActionsOrientation.HORIZONTAL,
			composites: this.getPanels(),
			openComposite: (compositeId: string) => this.openPanel(compositeId, true),
			getActivityAction: (compositeId: string) => this.instantiationService.createInstance(PanelActivityAction, this.getPanel(compositeId)),
			getCompositePinnedAction: (compositeId: string) => new ToggleCompositePinnedAction(this.getPanel(compositeId), this.compositeBar),
			getOnCompositeClickAction: (compositeId: string) => this.instantiationService.createInstance(OpenPanelAction, this.getPanel(compositeId)),
			getDefaultCompositeId: () => Registry.as<PanelRegistry>(PanelExtensions.Panels).getDefaultPanelId(),
			hidePart: () => this.partService.setPanelHidden(true)
		});
		this.toUnbind.push(this.compositeBar);

		this.registerListeners();
	}

	private registerListeners(): void {

		// Activate panel action on opening of a panel
		this.toUnbind.push(this.onDidPanelOpen(panel => this.compositeBar.activateComposite(panel.getId())));

		// Deactivate panel action on close
		this.toUnbind.push(this.onDidPanelClose(panel => this.compositeBar.deactivateComposite(panel.getId())));
		this.toUnbind.push(this.compositeBar.onDidContextMenu(e => this.showContextMenu(e)));
	}

	public get onDidPanelOpen(): Event<IPanel> {
		return this._onDidCompositeOpen.event;
	}

	public get onDidPanelClose(): Event<IPanel> {
		return this._onDidCompositeClose.event;
	}

	protected updateStyles(): void {
		super.updateStyles();

		const container = this.getContainer();
		container.style('background-color', this.getColor(PANEL_BACKGROUND));

		const title = this.getTitleArea();
		title.style('border-top-color', this.getColor(PANEL_BORDER) || this.getColor(contrastBorder));
	}

	public openPanel(id: string, focus?: boolean): TPromise<Panel> {
		if (this.blockOpeningPanel) {
			return TPromise.as(null); // Workaround against a potential race condition
		}

		// First check if panel is hidden and show if so
		let promise = TPromise.as<any>(null);
		if (!this.partService.isVisible(Parts.PANEL_PART)) {
			try {
				this.blockOpeningPanel = true;
				promise = this.partService.setPanelHidden(false);
			} finally {
				this.blockOpeningPanel = false;
			}
		}

		return promise.then(() => this.openComposite(id, focus));
	}

	private getPanel(panelId: string): IPanelIdentifier {
		return Registry.as<PanelRegistry>(PanelExtensions.Panels).getPanels().filter(p => p.id === panelId).pop();
	}

	private showContextMenu(e: MouseEvent): void {
		const event = new StandardMouseEvent(e);
		const actions: Action[] = this.getPanels().map(panel => this.instantiationService.createInstance(ToggleCompositePinnedAction, panel, this.compositeBar));

		this.contextMenuService.showContextMenu({
			getAnchor: () => { return { x: event.posx, y: event.posy }; },
			getActions: () => TPromise.as(actions),
			onHide: () => dispose(actions)
		});
	}

	public getPanels(): IPanelIdentifier[] {
		return Registry.as<PanelRegistry>(PanelExtensions.Panels).getPanels()
			.sort((v1, v2) => v1.order - v2.order);
	}

	protected getActions(): IAction[] {
		return [
			this.instantiationService.createInstance(ToggleMaximizedPanelAction, ToggleMaximizedPanelAction.ID, ToggleMaximizedPanelAction.LABEL),
			this.instantiationService.createInstance(ClosePanelAction, ClosePanelAction.ID, ClosePanelAction.LABEL)
		];
	}

	public getActivePanel(): IPanel {
		return this.getActiveComposite();
	}

	public getLastActivePanelId(): string {
		return this.getLastActiveCompositetId();
	}

	public hideActivePanel(): TPromise<void> {
		return this.hideActiveComposite().then(composite => void 0);
	}

	protected createTitleLabel(parent: Builder): ICompositeTitleLabel {
		const titleArea = this.compositeBar.create(parent.getHTMLElement());
		titleArea.classList.add('panel-switcher-container');

		return {
			updateTitle: (id, title, keybinding) => {
				const action = this.compositeBar.getAction(id);
				if (action) {
					action.label = title;
				}
			},
			updateStyles: () => {
				// Handled via theming participant
			}
		};
	}

	public layout(dimension: Dimension): Dimension[] {

		// Pass to super
		const sizes = super.layout(dimension);
		let availableWidth = dimension.width;
		if (this.toolBar) {
			// adjust height for global actions showing
			availableWidth -= this.toolBar.getContainer().getHTMLElement().offsetWidth;
		}
		this.compositeBar.layout(new Dimension(availableWidth, dimension.height));

		return sizes;
	}

	public shutdown(): void {
		// Persist Hidden State
		this.compositeBar.store();

		// Pass to super
		super.shutdown();
	}
}

registerThemingParticipant((theme: ITheme, collector: ICssStyleCollector) => {

	// Panel Background: since panels can host editors, we apply a background rule if the panel background
	// color is different from the editor background color. This is a bit of a hack though. The better way
	// would be to have a way to push the background color onto each editor widget itself somehow.
	const panelBackground = theme.getColor(PANEL_BACKGROUND);
	if (panelBackground && panelBackground !== theme.getColor(editorBackground)) {
		collector.addRule(`
			.monaco-workbench > .part.panel > .content .monaco-editor,
			.monaco-workbench > .part.panel > .content .monaco-editor .margin,
			.monaco-workbench > .part.panel > .content .monaco-editor .monaco-editor-background {
				background-color: ${panelBackground};
			}
		`);
	}

	// Title Active
	const titleActive = theme.getColor(PANEL_ACTIVE_TITLE_FOREGROUND);
	const titleActiveBorder = theme.getColor(PANEL_ACTIVE_TITLE_BORDER);
	if (titleActive || titleActiveBorder) {
		collector.addRule(`
			.monaco-workbench > .part.panel > .title > .panel-switcher-container > .monaco-action-bar .action-item:hover .action-label,
			.monaco-workbench > .part.panel > .title > .panel-switcher-container > .monaco-action-bar .action-item.checked .action-label {
				color: ${titleActive};
				border-bottom-color: ${titleActiveBorder};
			}
		`);
	}

	// Title Inactive
	const titleInactive = theme.getColor(PANEL_INACTIVE_TITLE_FOREGROUND);
	if (titleInactive) {
		collector.addRule(`
			.monaco-workbench > .part.panel > .title > .panel-switcher-container > .monaco-action-bar .action-item .action-label {
				color: ${titleInactive};
			}
		`);
	}

	// Title focus
	const focusBorderColor = theme.getColor(focusBorder);
	if (focusBorderColor) {
		collector.addRule(`
			.monaco-workbench > .part.panel > .title > .panel-switcher-container > .monaco-action-bar .action-item:focus {
				color: ${titleActive};
				border-bottom-color: ${focusBorderColor} !important;
				border-bottom: 1px solid;
				outline: none;
			}
		`);
	}

	// Styling with Outline color (e.g. high contrast theme)
	const outline = theme.getColor(activeContrastBorder);
	if (outline) {
		const outline = theme.getColor(activeContrastBorder);

		collector.addRule(`
			.monaco-workbench > .part.panel > .title > .panel-switcher-container > .monaco-action-bar .action-item.checked .action-label,
			.monaco-workbench > .part.panel > .title > .panel-switcher-container > .monaco-action-bar .action-item .action-label:hover {
				outline-color: ${outline};
				outline-width: 1px;
				outline-style: solid;
				border-bottom: none;
				padding-bottom: 0;
				outline-offset: 3px;
			}

			.monaco-workbench > .part.panel > .title > .panel-switcher-container > .monaco-action-bar .action-item:not(.checked) .action-label:hover {
				outline-style: dashed;
			}
		`);
	}
});