/// <reference types="../src/global.d.ts" />

import { Injectable } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import ava, { type TestFn } from 'ava';

import { ConfigModule } from '../src/config';
import { RevertCommand, RunCommand } from '../src/data/commands/run';
import { AuthModule } from '../src/modules/auth';
import { AuthService } from '../src/modules/auth/service';
import {
  FeatureManagementService,
  FeatureModule,
  FeatureService,
  FeatureType,
} from '../src/modules/features';
import { UserType } from '../src/modules/users/types';
import { WorkspaceResolver } from '../src/modules/workspaces/resolvers';
import { Permission } from '../src/modules/workspaces/types';
import { PrismaModule, PrismaService } from '../src/prisma';
import { RateLimiterModule } from '../src/throttler';
import { initFeatureConfigs } from './utils';

@Injectable()
class WorkspaceResolverMock {
  constructor(private readonly prisma: PrismaService) {}

  async createWorkspace(user: UserType, _init: null) {
    const workspace = await this.prisma.workspace.create({
      data: {
        public: false,
        permissions: {
          create: {
            type: Permission.Owner,
            user: {
              connect: {
                id: user.id,
              },
            },
            accepted: true,
          },
        },
      },
    });
    return workspace;
  }
}

const test = ava as TestFn<{
  auth: AuthService;
  feature: FeatureService;
  workspace: WorkspaceResolver;
  management: FeatureManagementService;
  app: TestingModule;
}>;

// cleanup database before each test
test.beforeEach(async () => {
  const client = new PrismaClient();
  await client.$connect();
  await client.user.deleteMany({});
  await client.workspace.deleteMany({});
  await client.$disconnect();
});

test.beforeEach(async t => {
  const module = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        auth: {
          accessTokenExpiresIn: 1,
          refreshTokenExpiresIn: 1,
          leeway: 1,
        },
        host: 'example.org',
        https: true,
        featureFlags: {
          earlyAccessPreview: true,
        },
      }),
      PrismaModule,
      AuthModule,
      FeatureModule,
      RateLimiterModule,
      RevertCommand,
      RunCommand,
    ],
    providers: [WorkspaceResolver],
  })
    .overrideProvider(WorkspaceResolver)
    .useClass(WorkspaceResolverMock)
    .compile();

  t.context.app = module;
  t.context.auth = module.get(AuthService);
  t.context.feature = module.get(FeatureService);
  t.context.workspace = module.get(WorkspaceResolver);
  t.context.management = module.get(FeatureManagementService);

  // init features
  await initFeatureConfigs(module);
});

test.afterEach.always(async t => {
  await t.context.app.close();
});

test('should be able to set user feature', async t => {
  const { auth, feature } = t.context;

  const u1 = await auth.signUp('DarkSky', 'darksky@example.org', '123456');

  const f1 = await feature.getUserFeatures(u1.id);
  t.is(f1.length, 0, 'should be empty');

  await feature.addUserFeature(u1.id, FeatureType.EarlyAccess, 2, 'test');

  const f2 = await feature.getUserFeatures(u1.id);
  t.is(f2.length, 1, 'should have 1 feature');
  t.is(f2[0].feature.name, FeatureType.EarlyAccess, 'should be early access');
});

test('should be able to check early access', async t => {
  const { auth, feature, management } = t.context;
  const u1 = await auth.signUp('DarkSky', 'darksky@example.org', '123456');

  const f1 = await management.canEarlyAccess(u1.email);
  t.false(f1, 'should not have early access');

  await management.addEarlyAccess(u1.id);
  const f2 = await management.canEarlyAccess(u1.email);
  t.true(f2, 'should have early access');

  const f3 = await feature.listFeatureUsers(FeatureType.EarlyAccess);
  t.is(f3.length, 1, 'should have 1 user');
  t.is(f3[0].id, u1.id, 'should be the same user');
});

test('should be able revert user feature', async t => {
  const { auth, feature, management } = t.context;
  const u1 = await auth.signUp('DarkSky', 'darksky@example.org', '123456');

  const f1 = await management.canEarlyAccess(u1.email);
  t.false(f1, 'should not have early access');

  await management.addEarlyAccess(u1.id);
  const f2 = await management.canEarlyAccess(u1.email);
  t.true(f2, 'should have early access');
  const q1 = await management.listEarlyAccess();
  t.is(q1.length, 1, 'should have 1 user');
  t.is(q1[0].id, u1.id, 'should be the same user');

  await management.removeEarlyAccess(u1.id);
  const f3 = await management.canEarlyAccess(u1.email);
  t.false(f3, 'should not have early access');
  const q2 = await management.listEarlyAccess();
  t.is(q2.length, 0, 'should have no user');

  const q3 = await feature.getUserFeatures(u1.id);
  t.is(q3.length, 1, 'should have 1 feature');
  t.is(q3[0].feature.name, FeatureType.EarlyAccess, 'should be early access');
  t.is(q3[0].activated, false, 'should be deactivated');
});

test('should be same instance after reset the user feature', async t => {
  const { auth, feature, management } = t.context;
  const u1 = await auth.signUp('DarkSky', 'darksky@example.org', '123456');

  await management.addEarlyAccess(u1.id);
  const f1 = (await feature.getUserFeatures(u1.id))[0];

  await management.removeEarlyAccess(u1.id);

  await management.addEarlyAccess(u1.id);
  const f2 = (await feature.getUserFeatures(u1.id))[1];

  t.is(f1.feature, f2.feature, 'should be same instance');
});

test('should be able to set workspace feature', async t => {
  const { auth, feature, workspace } = t.context;

  const u1 = await auth.signUp('DarkSky', 'darksky@example.org', '123456');
  const w1 = await workspace.createWorkspace(u1, null);

  const f1 = await feature.getWorkspaceFeatures(w1.id);
  t.is(f1.length, 0, 'should be empty');

  await feature.addWorkspaceFeature(w1.id, FeatureType.Copilot, 1, 'test');

  const f2 = await feature.getWorkspaceFeatures(w1.id);
  t.is(f2.length, 1, 'should have 1 feature');
  t.is(f2[0].feature.name, FeatureType.Copilot, 'should be copilot');
});

test('should be able to check workspace feature', async t => {
  const { auth, feature, workspace, management } = t.context;
  const u1 = await auth.signUp('DarkSky', 'darksky@example.org', '123456');
  const w1 = await workspace.createWorkspace(u1, null);

  const f1 = await management.hasWorkspaceFeature(w1.id, FeatureType.Copilot);
  t.false(f1, 'should not have copilot');

  await management.addWorkspaceFeatures(w1.id, FeatureType.Copilot, 1, 'test');
  const f2 = await management.hasWorkspaceFeature(w1.id, FeatureType.Copilot);
  t.true(f2, 'should have copilot');

  const f3 = await feature.listFeatureWorkspaces(FeatureType.Copilot);
  t.is(f3.length, 1, 'should have 1 workspace');
  t.is(f3[0].id, w1.id, 'should be the same workspace');
});

test('should be able revert workspace feature', async t => {
  const { auth, feature, workspace, management } = t.context;
  const u1 = await auth.signUp('DarkSky', 'darksky@example.org', '123456');
  const w1 = await workspace.createWorkspace(u1, null);

  const f1 = await management.hasWorkspaceFeature(w1.id, FeatureType.Copilot);
  t.false(f1, 'should not have feature');

  await management.addWorkspaceFeatures(w1.id, FeatureType.Copilot, 1, 'test');
  const f2 = await management.hasWorkspaceFeature(w1.id, FeatureType.Copilot);
  t.true(f2, 'should have feature');

  await management.removeWorkspaceFeature(w1.id, FeatureType.Copilot);
  const f3 = await management.hasWorkspaceFeature(w1.id, FeatureType.Copilot);
  t.false(f3, 'should not have feature');

  const q3 = await feature.getWorkspaceFeatures(w1.id);
  t.is(q3.length, 1, 'should have 1 feature');
  t.is(q3[0].feature.name, FeatureType.Copilot, 'should be copilot');
  t.is(q3[0].activated, false, 'should be deactivated');
});
