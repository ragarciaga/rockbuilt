// v0.2 compatibility shim: the contract parser now lives in contract.mjs (AGENTS.md first).
export {
  COMMAND_SECTIONS, HEADER_FIELDS, REQUIRED_SECTIONS, headerField, readContractText as readClaudeMd,
  sectionBody, sectionCommands, sectionHeadings, setHeaderField,
} from './contract.mjs';
