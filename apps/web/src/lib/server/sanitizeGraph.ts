export function sanitizeGraph(graph: any) {
	if (!graph) return graph;
	const stripData = (data: any) => {
		if (!data) return data;
		const {
			status,
			result,
			mapProgress,
			mapCompletedCount,
			mapTotalCount,
			mapWorkflowName,
			...rest
		} = data;
		return {
			...rest,
			...(data.mapWorkflowId ? { mapWorkflowId: data.mapWorkflowId } : {}),
			...(data.mapVersionId ? { mapVersionId: data.mapVersionId } : {}),
			...(data.mapVersionNumber ? { mapVersionNumber: data.mapVersionNumber } : {}),
			...(data.mapConcurrency ? { mapConcurrency: data.mapConcurrency } : {}),
			...(data.mapFailFast !== undefined ? { mapFailFast: data.mapFailFast } : {}),
			...(data.mapInputArray ? { mapInputArray: data.mapInputArray } : {}),
		};
	};

	return {
		...graph,
		nodes: (graph.nodes || []).map((n: any) => ({
			id: n.id,
			type: n.type,
			position: n.position,
			data: stripData(n.data),
		})),
		edges: graph.edges || [],
	};
}


