import { Injectable, InjectionToken } from '@angular/core';
import {
  Action,
  ActionReducer,
  MetaReducer,
  Store,
  StoreModule
} from '@ngrx/store';
import { Actions, Effect, EffectsModule } from '@ngrx/effects';

// Not using marble testing
import { TestBed } from '@angular/core/testing';

import { Observable, of } from 'rxjs';
import { map, skip } from 'rxjs/operators';

import { EntityAction, EntityActionFactory } from './actions/entity-action';
import { EntityActions } from './actions/entity-actions';
import { EntityOp, OP_ERROR } from './actions/entity-op';

import { EntityCache } from './reducers/entity-cache';
import { EntityCollection } from './reducers/entity-collection';
import { EntityCollectionCreator } from './reducers/entity-collection-creator';

import { EntityEffects, persistOps } from './effects/entity-effects';
import { NgrxDataModule } from './ngrx-data.module';

class TestEntityActions extends EntityActions {
  set stream(source: Observable<any>) {
    // source is deprecated but no known substitute
    /* tslint:disable-next-line:deprecation */
    this.source = source;
  }
}

const TEST_ACTION = 'test/get-everything-succeeded';
const EC_METAREDUCER_TOKEN = new InjectionToken<
  MetaReducer<EntityCache, Action>
>('EC MetaReducer');

@Injectable()
class TestEntityEffects {
  @Effect()
  test$: Observable<Action> = this.actions$
    .ofOp(persistOps)
    .pipe(map(this.testHook));

  testHook(action: EntityAction) {
    return {
      type: 'test-action',
      payload: action, // the incoming action
      entityName: action.entityName
    };
  }

  constructor(private actions$: EntityActions) {}
}

class Hero {
  id: number;
  name: string;
  power?: string;
}

class Villain {
  id: string;
  name: string;
}

const entityMetadata = {
  Hero: {},
  Villain: {}
};

//////// Tests begin ////////

describe('NgrxDataModule', () => {
  describe('with replaced EntityEffects', () => {
    // factory never changes in these tests
    const entityActionFactory = new EntityActionFactory();

    let actions$: Actions;
    let entityAction$: TestEntityActions;
    let store: Store<EntityCache>;
    let testEffects: TestEntityEffects;

    beforeEach(() => {
      TestBed.configureTestingModule({
        imports: [
          StoreModule.forRoot({}),
          EffectsModule.forRoot([]),
          NgrxDataModule.forRoot({
            entityMetadata: entityMetadata
          })
        ],
        providers: [{ provide: EntityEffects, useClass: TestEntityEffects }]
      });

      actions$ = TestBed.get(Actions);
      entityAction$ = TestBed.get(EntityActions);
      store = TestBed.get(Store);

      testEffects = TestBed.get(EntityEffects);
      spyOn(testEffects, 'testHook').and.callThrough();
    });

    it('should invoke test effect with an EntityAction', () => {
      const action = entityActionFactory.create('Hero', EntityOp.QUERY_ALL);
      const actions: Action[] = [];

      // listen for actions after the next dispatched action
      actions$.pipe(skip(1)).subscribe(act => actions.push(act));

      store.dispatch(action);
      expect(actions.length).toBe(1, 'expect one effect action');
      expect(actions[0].type).toBe('test-action');
    });

    it('should not invoke test effect with non-EntityAction', () => {
      const actions: Action[] = [];

      // listen for actions after the next dispatched action
      actions$.pipe(skip(1)).subscribe(act => actions.push(act));

      store.dispatch({ type: 'dummy-action' });
      expect(actions.length).toBe(0);
    });
  });

  describe('with EntityCacheMetaReducer', () => {
    let cacheSelector$: Observable<EntityCache>;
    let eaFactory: EntityActionFactory;
    let metaReducerLog: string[];
    let store: Store<{ entityCache: EntityCache }>;

    function loggingEntityCacheMetaReducer(
      reducer: ActionReducer<EntityCache, Action>
    ): ActionReducer<EntityCache, Action> {
      return (state: EntityCache, action: Action) => {
        metaReducerLog.push(`MetaReducer saw "${action.type}"`);
        return reducer(state, action);
      };
    }

    beforeEach(() => {
      metaReducerLog = [];

      TestBed.configureTestingModule({
        imports: [
          StoreModule.forRoot({}),
          EffectsModule.forRoot([]),
          NgrxDataModule.forRoot({
            entityMetadata: entityMetadata,
            entityCacheMetaReducers: [
              loggingEntityCacheMetaReducer,
              EC_METAREDUCER_TOKEN
            ]
          })
        ],
        providers: [
          { provide: EntityEffects, useValue: {} },
          {
            // Here's how you add an EntityCache metareducer with an injected service
            provide: EC_METAREDUCER_TOKEN,
            useFactory: entityCacheMetaReducerFactory,
            deps: [EntityCollectionCreator]
          }
        ]
      });

      store = TestBed.get(Store);
      cacheSelector$ = <any>store.select(state => state.entityCache);
      eaFactory = TestBed.get(EntityActionFactory);
    });

    it('should log an ordinary entity action', () => {
      const action = eaFactory.create('Hero', EntityOp.SET_LOADING);
      store.dispatch(action);
      expect(metaReducerLog.join('|')).toContain(
        EntityOp.SET_LOADING,
        'logged entity action'
      );
    });

    it('should respond to action handled by custom EntityCacheMetaReducer', () => {
      const data = {
        Hero: [
          { id: 2, name: 'B', power: 'Fast' },
          { id: 1, name: 'A', power: 'invisible' }
        ],
        Villain: [{ id: 30, name: 'Dr. Evil' }]
      };
      const action = {
        type: TEST_ACTION,
        payload: data
      };
      store.dispatch(action);
      cacheSelector$.subscribe(cache => {
        try {
          expect(cache.Hero.entities[1]).toEqual(
            data.Hero[1],
            'has expected hero'
          );
          expect(cache.Villain.entities[30]).toEqual(
            data.Villain[0],
            'has expected hero'
          );
          expect(metaReducerLog.join('|')).toContain(
            TEST_ACTION,
            'logged test action'
          );
        } catch (error) {
          fail(error);
        }
      }, fail);
    });
  });
});

// #region helpers

/** Create the test entityCacheMetaReducer, injected in tests */
function entityCacheMetaReducerFactory(
  collectionCreator: EntityCollectionCreator
) {
  return (reducer: ActionReducer<EntityCache, Action>) => {
    return (state: EntityCache, action: { type: string; payload?: any }) => {
      switch (action.type) {
        case TEST_ACTION: {
          const mergeState = {
            Hero: createCollection<Hero>('Hero', action.payload['Hero'] || []),
            Villain: createCollection<Villain>(
              'Villain',
              action.payload['Villain'] || []
            )
          };
          return { ...state, ...mergeState };
        }
      }
      return reducer(state, action);
    };
  };

  function createCollection<T extends { id: any }>(
    entityName: string,
    data: T[]
  ) {
    return {
      ...collectionCreator.create<T>(entityName),
      ids: data.map(e => e.id),
      entities: data.reduce(
        (acc, e) => {
          acc[e.id] = e;
          return acc;
        },
        {} as any
      )
    } as EntityCollection<T>;
  }
}
// #endregion
