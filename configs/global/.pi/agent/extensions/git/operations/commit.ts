import { createCommitOperation } from "../commit-operation.ts";
import { runPiProcess } from "../../shared/pi-process-runner.ts";

export default createCommitOperation({
	runPiProcess,
});
