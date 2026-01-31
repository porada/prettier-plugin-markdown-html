export namespace AST {
	export type Node = {
		children?: Node[];
		type?: string;
		value?: string;
	};

	export type RootNode = {
		children: Node[];
		type: 'root';
	};

	export type HTMLNode = {
		type: 'html';
		value: string;
	};
}
