// Group 0 is the pass, group 1 the draw.
@group(0) @binding(0) var<uniform> u_frame: Frame;
@group(0) @binding(1) var t_dfg: texture_2d<f32>;
@group(0) @binding(2) var s_linear: sampler;
@group(0) @binding(3) var t_env: texture_2d<f32>;
@group(0) @binding(4) var t_shadow: texture_depth_2d;
@group(0) @binding(5) var s_shadow: sampler_comparison;
@group(0) @binding(6) var t_transmission: texture_2d<f32>;
@group(0) @binding(7) var s_trilinear: sampler;
@group(1) @binding(0) var<uniform> u_draw: Draw;
@group(1) @binding(1) var t_map: texture_2d<f32>;
@group(1) @binding(2) var s_map: sampler;
@group(1) @binding(3) var t_bump: texture_2d<f32>;
@group(1) @binding(4) var s_bump: sampler;
