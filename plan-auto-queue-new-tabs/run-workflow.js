export const meta = {
  name: "run-workflow",
  description: "PLAN の execution-graph.json を ready-set スケジューラで並列実行する",
  phases: ["Implement", "Integrate"],
};

export default async function run({ agent, args }) {
  const graph = args.executionGraph && Array.isArray(args.executionGraph.exec_nodes)
    ? args.executionGraph
    : args;
  const nodes = graph.exec_nodes;
  if (!Array.isArray(nodes)) {
    throw new Error("args.exec_nodes missing");
  }
  const limit = createLimiter(args.maxParallelProcesses);
  const results = new Map();

  function buildOpts(node) {
    const opts = {};
    if (node.isolation) Object.assign(opts, { isolation: "worktree" });
    if (node.model) opts.model = node.model;
    return opts;
  }

  function runNode(node, phase) {
    return agent({
      phase,
      prompt: `${node.core_path} を Read し、その本文だけで実装・検証・完了判定を単体で完遂してください。完了後、GoalEvidence を構造化形式で返してください。`,
      opts: buildOpts(node),
    });
  }

  function schedule(id) {
    if (results.has(id)) return results.get(id);
    const node = nodes.find((n) => n.id === id);
    const p = Promise.all(node.depends_on.map(schedule)).then(async (depResults) => {
      const failed = (r) => r === null || (r && r.human_escalation_required === true);
      if (depResults.some(failed)) return null;
      const phase = node.is_merge ? "Integrate" : "Implement";
      if (!node.is_merge) {
        return limit(() => runNode(node, phase)).catch(() => null);
      }
      const firstAttempt = await limit(() => runNode(node, phase)).catch(() => null);
      if (firstAttempt !== null && !failed(firstAttempt)) return firstAttempt;
      const members = node.merges || [];
      for (const memberId of members) {
        const member = nodes.find((n) => n.id === memberId);
        if (!member) continue;
        await limit(() => runNode(member, "Implement")).catch(() => null);
      }
      const retryAttempt = await limit(() => runNode(node, phase)).catch(() => null);
      if (retryAttempt !== null && !failed(retryAttempt)) return retryAttempt;
      return { status: "fail", human_escalation_required: true, node_id: node.id };
    });
    results.set(id, p);
    return p;
  }

  return Promise.all(nodes.map((n) => schedule(n.id)));
}

function createLimiter(maxParallel) {
  if (typeof maxParallel !== "number" || maxParallel < 1) {
    throw new Error("args.maxParallelProcesses required");
  }
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= maxParallel || queue.length === 0) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    fn().then(resolve, reject).finally(() => {
      active--;
      next();
    });
  };
  return (fn) => new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    next();
  });
}
