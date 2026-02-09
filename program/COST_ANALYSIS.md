# Analyse des Coûts - Déploiement Program Solana

## Situation Actuelle
- **Solde wallet** : 0.959430925 SOL
- **Program déployé** : `57MA23vJ2yS9FV2oL4bz5GcKoXWXGhc25R61PU8dgefD`
- **Balance du program** : 2.2748412 SOL (rent)
- **Total disponible** : 3.234272125 SOL

## Transactions Identifiées

### 1. Premier Déploiement (2pRb2h...)
- **Program ID** : `C16J1ZLPVMZXZLWXvkR3rsEhsf9hU5f2GRfNzNqgk7W5`
- **Coût** : ~2.27 SOL (création du program account)
- **Résultat** : Program déployé mais avec mismatch de Program ID

### 2. Suppression du Premier Program
- **Action** : `solana program close C16J1ZLPVMZXZLWXvkR3rsEhsf9hU5f2GRfNzNqgk7W5`
- **Récupération** : 2.2748412 SOL (rent récupéré)
- **Net** : +2.27 SOL

### 3. Tentative d'Upgrade (ÉCHOUÉE)
- **Buffer Account créé** : `QeeXoYtZbWjT9yjLwRB1KFPQ57gyKPwW8oGqs5y3W7i`
- **Coût** : ~2.27 SOL (buffer account créé mais jamais utilisé)
- **Résultat** : Échec car solde insuffisant
- **⚠️ PROBLÈME** : Ce buffer account contient toujours ~2.27 SOL qui sont bloqués !

### 4. Deuxième Déploiement (73Mbgg...)
- **Program ID** : `57MA23vJ2yS9FV2oL4bz5GcKoXWXGhc25R61PU8dgefD`
- **Coût** : ~2.27 SOL (création du nouveau program account)
- **Résultat** : Program déployé avec succès ✅

## Calcul des Pertes

### SOL Dépensés
1. Premier déploiement : 2.27 SOL
2. Buffer account (upgrade échoué) : 2.27 SOL ⚠️ **BLOQUÉ**
3. Deuxième déploiement : 2.27 SOL
**Total dépensé** : 6.81 SOL

### SOL Récupérés
1. Suppression premier program : 2.27 SOL
**Total récupéré** : 2.27 SOL

### Net
- **Perte nette** : 6.81 - 2.27 = **4.54 SOL**
- **SOL bloqués dans buffer** : **2.27 SOL** (récupérables !)

## ⚠️ SOL BLOQUÉS DANS LE BUFFER ACCOUNT

Le buffer account `QeeXoYtZbWjT9yjLwRB1KFPQ57gyKPwW8oGqs5y3W7i` contient ~2.27 SOL qui peuvent être récupérés !

### Comment récupérer les SOL du buffer :

```bash
solana program close QeeXoYtZbWjT9yjLwRB1KFPQ57gyKPwW8oGqs5y3W7i
```

Ou avec la seed phrase :
```bash
solana-keygen recover -o /tmp/buffer-keypair.json "edit crew sound punch fresh pigeon candy upset win torch ankle bomb"
solana program close QeeXoYtZbWjT9yjLwRB1KFPQ57gyKPwW8oGqs5y3W7i --bypass-warning
```

## Résumé

- **SOL réellement perdus** : 2.27 SOL (premier déploiement + deuxième déploiement - récupération)
- **SOL récupérables** : 2.27 SOL (dans le buffer account)
- **SOL dans le program actuel** : 2.27 SOL (rent, récupérable si vous supprimez le program)

**Total si vous récupérez le buffer** : 0.96 + 2.27 = **3.23 SOL**
