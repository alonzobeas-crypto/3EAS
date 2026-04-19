/**
 * WebGL Scene — Subtle starfield / particle system
 * Matches the dark, technical aesthetic of the 3EAS design system.
 * Pure white/grey particles, minimal motion, no color.
 */

class WebGLScene {
    constructor() {
        this.canvas = document.getElementById('webgl-canvas');
        if (!this.canvas || typeof THREE === 'undefined') return;

        this.scene    = null;
        this.camera   = null;
        this.renderer = null;
        this.particles = null;
        this.lines     = null;
        this.clock     = new THREE.Clock();
        this._paused   = false;

        this._init();
        this._animate();
        this._bindResize();
        this._bindVisibility();
    }

    _init() {
        /* Scene */
        this.scene = new THREE.Scene();

        /* Camera */
        this.camera = new THREE.PerspectiveCamera(
            60,
            window.innerWidth / window.innerHeight,
            0.1,
            500
        );
        this.camera.position.set(0, 0, 60);

        /* Renderer */
        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: false,
            alpha: true,
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
        this.renderer.setClearColor(0x000000, 0); // transparent — CSS sets bg

        /* Particles — starfield */
        this._createStarfield();

        /* Fine grid lines — depth planes */
        this._createDepthLines();
    }

    _createStarfield() {
        const COUNT = 1800;
        const positions = new Float32Array(COUNT * 3);
        const alphas    = new Float32Array(COUNT);

        for (let i = 0; i < COUNT; i++) {
            positions[i * 3]     = (Math.random() - 0.5) * 200;
            positions[i * 3 + 1] = (Math.random() - 0.5) * 200;
            positions[i * 3 + 2] = (Math.random() - 0.5) * 200;
            alphas[i]             = Math.random() * 0.5 + 0.1;
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        const mat = new THREE.PointsMaterial({
            size: 0.35,
            color: 0xffffff,
            transparent: true,
            opacity: 0.45,
            sizeAttenuation: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        this.particles = new THREE.Points(geo, mat);
        this.scene.add(this.particles);

        /* Larger, brighter sparse stars */
        const FEW = 80;
        const bigPos = new Float32Array(FEW * 3);
        for (let i = 0; i < FEW; i++) {
            bigPos[i * 3]     = (Math.random() - 0.5) * 180;
            bigPos[i * 3 + 1] = (Math.random() - 0.5) * 180;
            bigPos[i * 3 + 2] = (Math.random() - 0.5) * 100;
        }
        const bigGeo = new THREE.BufferGeometry();
        bigGeo.setAttribute('position', new THREE.BufferAttribute(bigPos, 3));
        const bigMat = new THREE.PointsMaterial({
            size: 0.8,
            color: 0xffffff,
            transparent: true,
            opacity: 0.7,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });
        const bigStars = new THREE.Points(bigGeo, bigMat);
        this.scene.add(bigStars);
    }

    _createDepthLines() {
        /* A few subtle receding horizontal/vertical lines in perspective */
        const lineMat = new THREE.LineBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.04,
        });

        const LINES = 8;
        for (let i = 0; i < LINES; i++) {
            const points = [
                new THREE.Vector3(-100, (i - LINES / 2) * 12, -60),
                new THREE.Vector3( 100, (i - LINES / 2) * 12, -60),
            ];
            const geo = new THREE.BufferGeometry().setFromPoints(points);
            const line = new THREE.Line(geo, lineMat);
            this.scene.add(line);
        }
        for (let i = 0; i < LINES; i++) {
            const points = [
                new THREE.Vector3((i - LINES / 2) * 14, -100, -60),
                new THREE.Vector3((i - LINES / 2) * 14,  100, -60),
            ];
            const geo = new THREE.BufferGeometry().setFromPoints(points);
            const line = new THREE.Line(geo, lineMat);
            this.scene.add(line);
        }
    }

    _animate() {
        requestAnimationFrame(() => this._animate());
        if (this._paused) return;

        const t = this.clock.getElapsedTime();

        if (this.particles) {
            // Very slow drift
            this.particles.rotation.y = t * 0.008;
            this.particles.rotation.x = Math.sin(t * 0.015) * 0.03;
        }

        // Gentle camera drift
        this.camera.position.x = Math.sin(t * 0.04) * 1.5;
        this.camera.position.y = Math.cos(t * 0.03) * 0.8;
        this.camera.lookAt(0, 0, 0);

        this.renderer.render(this.scene, this.camera);
    }

    _bindResize() {
        window.addEventListener('resize', () => {
            if (!this.camera || !this.renderer) return;
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });
    }

    _bindVisibility() {
        document.addEventListener('visibilitychange', () => {
            this._paused = document.hidden;
            if (!document.hidden) this.clock.getDelta(); // reset delta
        });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    if (typeof THREE !== 'undefined') {
        new WebGLScene();
    }
});
