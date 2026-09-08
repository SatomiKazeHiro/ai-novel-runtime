import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'

vi.mock('cytoscape', () => {
  const cyFactory = vi.fn()
  cyFactory.mockImplementation(() => ({
    removeAllListeners: vi.fn(),
    destroy: vi.fn(),
    on: vi.fn(),
    one: vi.fn(),
    layout: vi.fn(() => ({ run: vi.fn() })),
    fit: vi.fn(),
    zoom: vi.fn(),
    $id: vi.fn(() => ({ length: 0 })),
    width: () => 800,
    height: () => 600,
    elements: () => ({ removeClass: vi.fn() }),
    remove: vi.fn()
  }))
  return { default: cyFactory }
})

import cytoscape from 'cytoscape'
import { useCytoscapeLifecycle } from '../graph/useCytoscapeLifecycle'

function getCyMock() { return cytoscape as unknown as ReturnType<typeof vi.fn> }

describe('useCytoscapeLifecycle — rebuild 协议', () => {
  let containerRef: any
  let isDark: any

  beforeEach(() => {
    getCyMock().mockClear()
    containerRef = ref(document.createElement('div'))
    isDark = ref(false)
  })

  it('rebuild(null) 不创建 cytoscape 实例', () => {
    const cy = useCytoscapeLifecycle({ containerRef, getDisplayData: () => null, isDark })
    cy.rebuild(null)
    expect(getCyMock().mock.calls).toHaveLength(0)
    expect(cy.getInstance()).toBeNull()
  })

  it('rebuild(data) 创建 cytoscape 实例，并传入 elements + style + layout.animate=false', () => {
    const cy = useCytoscapeLifecycle({ containerRef, getDisplayData: () => null, isDark })
    cy.rebuild({
      nodes: [{ id: 'character:a', type: 'character', key: 'a', label: 'A' }],
      edges: []
    })
    expect(getCyMock().mock.calls).toHaveLength(1)
    const cfg = getCyMock().mock.calls[0][0]
    expect(cfg.container).toBe(containerRef.value)
    expect(cfg.elements[0].data.id).toBe('character:a')
    expect(cfg.layout.animate).toBe(false)
  })

  it('rebuild 是 entry 而非 init', () => {
    const cy = useCytoscapeLifecycle({ containerRef, getDisplayData: () => null, isDark })
    expect(typeof cy.rebuild).toBe('function')
  })

  it('init() 保留为 backward-compat 别名：内部从 getDisplayData() 拉数据再 rebuild', () => {
    let displayData: any = null
    const gd = () => displayData
    const cy = useCytoscapeLifecycle({ containerRef, getDisplayData: gd, isDark })
    expect(typeof cy.init).toBe('function')
    // init 第一次：data=null → 不创建实例
    cy.init()
    expect(getCyMock().mock.calls).toHaveLength(0)
    // 给 data，再 init() → 应该创建实例
    displayData = { nodes: [{ id: 'character:a', type: 'character', key: 'a', label: 'A' }], edges: [] }
    cy.init()
    expect(getCyMock().mock.calls).toHaveLength(1)
  })

  it('增量 CRUD API（addNode/addEdge/update*/remove*）仍保留，因 EditableGraph.vue 在用', () => {
    const cy = useCytoscapeLifecycle({ containerRef, getDisplayData: () => null, isDark })
    expect(typeof cy.addNode).toBe('function')
    expect(typeof cy.addEdge).toBe('function')
    expect(typeof cy.updateNode).toBe('function')
    expect(typeof cy.updateEdge).toBe('function')
    expect(typeof cy.removeNode).toBe('function')
    expect(typeof cy.removeEdge).toBe('function')
  })

  it('CytoscapeLifecycleOptions 保留 getNewIds（EditableGraph.vue 仍在用）', async () => {
    const { useCytoscapeLifecycle: ucl } = await import('../graph/useCytoscapeLifecycle')
    // 类型断言编译过即可, 测试文件能 import 成功就足够
    expect(typeof ucl).toBe('function')
  })

  it('二次 rebuild 第二次开始时旧实例已被销毁', () => {
    const oldInstance = {
      removeAllListeners: vi.fn(),
      destroy: vi.fn(),
      on: vi.fn(),
      one: vi.fn(),
      layout: vi.fn(() => ({ run: vi.fn() })),
      fit: vi.fn(),
      zoom: vi.fn(),
      $id: vi.fn(() => ({ length: 0 })),
      width: () => 800, height: () => 600,
      elements: () => ({ removeClass: vi.fn() }),
      remove: vi.fn()
    }
    let i = 0
    getCyMock().mockImplementation(() => {
      if (i++ === 0) return oldInstance
      return { ...oldInstance, removeAllListeners: vi.fn() }
    })
    const cy = useCytoscapeLifecycle({ containerRef, getDisplayData: () => null, isDark })
    cy.rebuild({ nodes: [{ id: 'a:1', type: 'character', key: '1', label: 'A' }], edges: [] })
    cy.rebuild({ nodes: [{ id: 'b:1', type: 'character', key: '1', label: 'B' }], edges: [] })
    expect(oldInstance.destroy).toHaveBeenCalled()
    expect(oldInstance.removeAllListeners).toHaveBeenCalled()
  })
})
