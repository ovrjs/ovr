---
"ovr": minor
---

`JSX.Component` types a component taken as a value.

```tsx
function Card(props: { icon: JSX.Component<{ size: number }> }) {
	return <props.icon size={16} />;
}
```

A component fits it whether or not it reads the context, which is its second parameter.
