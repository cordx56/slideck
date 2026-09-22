import * as compile from "./state/compile.svelte";
import * as document from "./state/document.svelte";
import * as files from "./state/files.svelte";
import * as github from "./state/github.svelte";
import * as project from "./state/project.svelte";

export type { SyncStatus } from "./state/github.svelte";

export const store = {
  get booting() {
    return project.isBooting();
  },
  get openPath() {
    return document.path();
  },
  get isYamlOpen() {
    return document.isYamlOpen();
  },
  get isTextOpen() {
    return document.isTextOpen();
  },
  get isImageOpen() {
    return document.isImageOpen();
  },
  get yamlText() {
    return document.text();
  },
  get dirty() {
    return document.isDirty();
  },
  get compiled() {
    return compile.compiledDeck();
  },
  get errors() {
    return compile.pipelineErrors();
  },
  get currentSlide() {
    return document.slide();
  },
  set currentSlide(value: number) {
    document.setCurrentSlide(value);
  },
  get editorCursorTarget() {
    return document.cursorTarget();
  },
  set editorCursorTarget(value: number | null) {
    document.setCursorTarget(value);
  },
  get files() {
    return files.fileEntries();
  },
  get brokenRefs() {
    return compile.brokenReferences();
  },
  get filesWithBrokenRefs() {
    return compile.filesWithBrokenRefs();
  },
  get ready() {
    return project.isReady();
  },
  get currentProject() {
    return project.projectName();
  },
  get projects() {
    return project.projects();
  },
  get templates() {
    return project.templates();
  },
  markTemplate: project.markTemplate,
  unmarkTemplate: project.unmarkTemplate,
  projectExists: project.projectExists,
  get slideCount() {
    return compile.slideCount();
  },
  get slideAspect() {
    return compile.slideAspect();
  },
  get vfs() {
    return project.vfs();
  },
  get serverMode() {
    return project.isServerMode();
  },
  get github() {
    return github.github();
  },
  connectGithub: github.connectGithub,
  disconnectGithub: github.disconnectGithub,
  listGithubRepos: github.listGithubRepos,
  cloneProject: github.cloneProject,
  linkRepo: github.linkRepo,
  unlinkRepo: github.unlinkRepo,
  pull: github.pull,
  push: github.push,
  dismissSyncWarning: github.dismissSyncWarning,
  boot: project.boot,
  openProject: project.openProject,
  createProject: project.createProject,
  createFromTemplate: project.createFromTemplate,
  deleteProject: project.deleteProject,
  openFile: document.openFile,
  save: document.save,
  setYaml: document.setYaml,
  exportZip: files.exportZip,
  importZip: files.importZip,
  get expanded() {
    return files.expandedPaths();
  },
  get showHidden() {
    return files.hiddenFilesShown();
  },
  isExpanded: files.isExpanded,
  toggleExpanded: files.toggleExpanded,
  setExpanded: files.setExpanded,
  toggleHidden: files.toggleHidden,
  createFile: files.createFile,
  createFolder: files.createFolder,
  renamePath: files.renamePath,
  moveNode: files.moveNode,
  followMove: files.followMove,
  deletePath: files.deletePath,
  duplicatePath: files.duplicatePath,
  downloadFile: files.downloadFile,
  uploadEntries: files.uploadEntries,
  goSlide: document.goSlide,
  next: document.next,
  prev: document.prev,
  cursorMoved: document.cursorMoved,
  renderSvg: compile.renderSvg,
};
